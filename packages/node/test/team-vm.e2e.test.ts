import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyFingerprint, ceilingThreads, clientIdFromKey, KERNEL, type LedgerEntry, REFERENCE_SINGLE, routes, type Scope, signRequest, teamArmLabel, type RouteName, type SandboxView, type TeamSnapshot, type TeamTask, utf8 } from "@galahad/core";
import { requestPairing, waitForApproval } from "@galahad/link";
import { foundFleet, MindStore } from "@galahad/mind";
import { startDaemon, type Daemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";
import type { Capabilities } from "../src/capabilities.ts";
import { Database } from "bun:sqlite";
import { fakeDocker } from "./fake-docker.ts";
import { readWorldEvent } from "../../../apps/web/src/lib/world.ts";

// Real HTTP/controller/host/quest code, with stand-ins only for Docker and models.
const root = mkdtempSync(join(tmpdir(), "galahad-team-vm-"));
const home = new Home(join(root, "node"));
const freePort = () => { const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }); const p = s.port!; s.stop(true); return p; };
const port = freePort();
const caps: Capabilities = { os: "linux", arch: "x64", hostname: "team-vm-test", cores: 16, cpu: "test", memoryGb: 32, hasBattery: false, gpu: [], docker: true, vm: { kvm: true, tools: ["kata"] }, tools: ["docker"], localModels: [], tailscale: null, sandbox: { image: true, networks: true, vm: true } };
const docker = fakeDocker();
const runs: string[][] = [];
const events: { kind: "cleanup" | "lease" | "exec" | "model"; target: string; text: string }[] = [];
const active = new Map<string, number>();
const peak = new Map<string, number>();
const prompts: { model: string; messages: { role: string; content: string }[] }[] = [];
let daemon: Daemon;
let alphaEntered = false;
let releaseAlpha: (() => void) | undefined;
let alphaHold: Promise<void> | undefined;
let cleanupFailure = false;
let dockerSilent = false;
// The worker as the SANDBOX would show it: the node's hello as it goes over the wire, read by the page's own reader.
function worldWorker(id: string) {
  const hello = readWorldEvent(JSON.parse(JSON.stringify(daemon.world.hello())));
  if (hello?.type !== "hello") throw new Error("Expected world hello");
  return hello.partners?.find((partner) => partner.id === teamArmLabel(daemon.identity.id, id));
}
const summaries: Record<string, string> = { ALPHA: "Verified predecessor contract: packet-v1.", BETA: "Verified independent follow-up.", GAMMA: "Verified consumer of packet-v1." };
const model = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (request) => {
  const body = await request.json() as (typeof prompts)[number];
  prompts.push(body);
  const turns = body.messages.filter((message) => message.role !== "system");
  const task = /TASK_(ALPHA|BETA|GAMMA|CLEANUP)/.exec(turns[0]?.content ?? "")?.[1] ?? "UNKNOWN";
  events.push({ kind: "model", target: task, text: body.model });
  let text = "1. Make the change.\n2. Run the required gate.\nDone when: the gate and independent review pass.";
  if (body.model === "engineer") {
    text = turns.some((message) => message.role === "assistant")
      ? `DONE\n${summaries[task] ?? "Unexpected task."}`
      : `\`\`\`sh\nprintf '%s' ${task} > result.txt # write-${task.toLowerCase()}\n\`\`\``;
  } else if (body.model === "reviewer") text = "PASS\nThe required gate passed and execution evidence supports the result.";
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });

async function api<T = any>(name: RouteName, input?: unknown): Promise<T> {
  const route = routes[name];
  const response = await fetch(`http://127.0.0.1:${port}${route.path}`, { method: route.method,
    headers: { authorization: `Bearer ${home.adminToken()}`, "content-type": "application/json" },
    body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
  const body = await response.json() as { error?: string; status?: number };
  if (!response.ok || body.error) throw new Error(`${name}: ${response.status} ${body.error ?? "request failed"}`);
  return body as T;
}
async function until(condition: () => boolean | Promise<boolean>) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (await condition()) return; await Bun.sleep(5); }
  const state = await api<TeamSnapshot>("team");
  throw new Error(`team VM condition was not reached: ${JSON.stringify(state.tasks.map(({ title, status, error }) => ({ title, status, error })))}`);
}
/** One of your own devices, paired with these scopes: its requests are signed, as a phone's are. */
async function pairDevice(name: string, scopes: Scope[]) {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const id = clientIdFromKey(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
  const { invite } = await api<{ invite: string }>("createInvite", { kind: "client", scopes });
  const joining = await requestPairing(invite, { device: id, name, kind: "client" });
  const mine = (await api<{ pairings: { invite: string; device: string }[] }>("pairings")).pairings.find((pairing) => pairing.device === id)!;
  await api("approvePairing", { invite: mine.invite, device: mine.device });
  await waitForApproval(joining, { intervalMs: 20 });
  return async (name: RouteName, input?: unknown): Promise<Response> => {
    const route = routes[name];
    const bytes = route.method === "POST" ? utf8(JSON.stringify(input ?? {})) : new Uint8Array();
    const headers = await signRequest(id, async (m) => new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, m)), route.method, route.path, bytes);
    return fetch(`http://127.0.0.1:${port}${route.path}`, { method: route.method, headers: { ...headers, "content-type": "application/json" }, body: route.method === "POST" ? bytes : undefined });
  };
}
const snapshot = () => api<TeamSnapshot>("team");
const task = async (id: string) => (await snapshot()).tasks.find((item) => item.id === id)!;
const create = (assignee: string, tag: string, dependsOn: string[] = []) => api<{ task: TeamTask }>("createTeamTask", {
  room: "vm-forge", assignee, title: tag, goal: `TASK_${tag}: Build and verify this bounded change.`, dependsOn, gates: [`test -f result.txt # gate-${tag.toLowerCase()}`],
});
const start = () => startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {},
  docker: (args, timeout) => {
    if (args[0] === "run") runs.push(args);
    // Docker that cannot say what is there (its daemon is busy or restarting): never the same as "nothing is there".
    if (dockerSilent && args[0] === "ps") return Promise.resolve({ code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" });
    return docker.runner(args, timeout);
  },
  measure: async (reason, body, limit) => {
    const threads = ceilingThreads(body, limit);
    return { at: Date.now(), tookMs: 1, reason, body: bodyFingerprint(body, limit), cpu: { single: REFERENCE_SINGLE, multi: REFERENCE_SINGLE * threads, threads, kernel: KERNEL } };
  },
  shutdownGraceMs: 100, defaultHeartbeat: false, archiveIntervalMs: false,
});

beforeAll(async () => {
  const { identity, keystore } = await home.createIdentity("file");
  const mind = new MindStore(home.mindPath);
  const fleet = foundFleet(mind, identity, { fleetName: "team-vms", nodeName: "keep" }); mind.close();
  home.writeConfig({ v: 1, name: "keep", fleet, port, keystore, advertise: "127.0.0.1" });
  docker.onExec = async (container, command) => {
    const text = command.join("\n");
    const kind = text.includes("def cleanup(") ? "cleanup" : text.includes("tempfile.mkstemp") ? "lease" : "exec";
    events.push({ kind, target: container, text });
    const count = (active.get(container) ?? 0) + 1;
    active.set(container, count); peak.set(container, Math.max(peak.get(container) ?? 0, count));
    try {
      if (kind === "cleanup" && cleanupFailure) return { code: 137, stdout: "", stderr: "cleanup deadline expired" };
      if (text.includes("write-alpha")) { alphaEntered = true; await alphaHold; }
      return { code: 0, stdout: text.includes("gate-") ? "required gate passed" : "command completed" };
    } finally { active.set(container, count - 1); }
  };
  daemon = await start();
  await until(() => daemon.store.lww(`calibration:${daemon.identity.id}`) !== null);
  await api("setProvider", { id: "stand-in", kind: "openai", baseUrl: `http://127.0.0.1:${model.port}/v1` });
  for (const role of ["planner", "engineer", "reviewer"]) await api("setRoster", { role, models: [`stand-in/${role}`] });
  for (const id of ["ada", "lin"]) await api("saveTeammate", { id, name: id.toUpperCase(), role: "engineer" });
  await api("saveTeamRoom", { id: "vm-forge", name: "VM Forge", members: ["ada", "lin"] });
});
afterAll(async () => { releaseAlpha?.(); await daemon?.stop(); model.stop(true); rmSync(root, { recursive: true, force: true }); });

test("first task provisions one persistent VM; same-worker tasks serialize and verified dependencies cross workers", async () => {
  expect(runs).toHaveLength(0);
  expect((await snapshot()).teammates.every((member) => member.workspace === null)).toBe(true);
  alphaHold = new Promise<void>((resolve) => { releaseAlpha = resolve; });
  const alpha = (await create("ada", "ALPHA")).task;
  try {
    await until(() => alphaEntered);
    const beta = (await create("ada", "BETA")).task;
    const gamma = (await create("lin", "GAMMA", [alpha.id])).task;
    const held = await snapshot();
    expect(held.tasks.find((item) => item.id === alpha.id)?.status).toBe("running");
    expect(held.tasks.find((item) => item.id === beta.id)?.status).toBe("queued");
    expect(held.tasks.find((item) => item.id === gamma.id)?.status).toBe("queued");
    expect(held.teammates.find((member) => member.id === "lin")?.workspace).toBeNull();
    const bound = held.teammates.find((member) => member.id === "ada")!.workspace!;
    expect(worldWorker("ada")).toMatchObject({ expression: "working", avatar: held.teammates.find((member) => member.id === "ada")!.avatar });
    expect(bound.id).toMatch(/^[0-9a-f]{10}$/);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain(`dev.galahad.quest=arm.${teamArmLabel(daemon.identity.id, "ada")}`);
    expect(runs[0]).toContain("dev.galahad.ephemeral=false");
    expect(runs[0]).toContain("dev.galahad.isolation=vm");
    expect(runs[0]).toContain("io.containerd.kata.v2");
    // A UI readiness probe must not become a second writer while this task owns the VM.
    const busy = await api<{ workspace: SandboxView; harnesses: { id: string; ready: boolean }[] }>("teamWorkspace", { id: "ada" });
    expect(busy.workspace.id).toBe(bound.id);
    expect(busy.harnesses.filter((h) => h.id !== "native").every((h) => !h.ready)).toBe(true);
    expect(peak.get(`galahad-sbx-${bound.id}`)).toBe(1);
    releaseAlpha!();
    await until(async () => (await snapshot()).tasks.every((item) => !["queued", "running"].includes(item.status)));
    const finished = await snapshot();
    expect(worldWorker("ada")?.expression).toBe("pleased");
    expect(worldWorker("lin")?.expression).toBe("pleased");
    expect(JSON.stringify(worldWorker("ada"))).not.toContain(summaries.ALPHA!);
    for (const id of [alpha.id, beta.id, gamma.id]) expect(finished.tasks.find((item) => item.id === id)).toMatchObject({ status: "done", verified: true, error: null });
    expect(finished.teammates.find((member) => member.id === "ada")!.workspace).toEqual(bound);
    const other = finished.teammates.find((member) => member.id === "lin")!.workspace!;
    expect(other.id).not.toBe(bound.id);
    expect(runs).toHaveLength(2);
    expect([...peak.values()].every((value) => value === 1)).toBe(true);
    for (const id of [bound.id, other.id]) {
      const activity = events.filter((event) => event.target === `galahad-sbx-${id}`);
      const lease = activity.findIndex((event) => event.kind === "lease");
      expect(activity[0]?.kind).toBe("cleanup");
      expect(lease).toBeGreaterThanOrEqual(0);
      expect(lease).toBeLessThan(activity.findIndex((event) => event.text.includes("mkdir -p")));
    }
    const consumer = prompts.find((body) => body.model === "engineer" && body.messages.some((message) => message.content.startsWith("Quest: TASK_GAMMA")))!;
    expect(JSON.stringify(consumer)).toContain(summaries.ALPHA!);
    expect(JSON.stringify(consumer)).toContain("Verified predecessor results (file paths belong to their original VM)");
    for (const tag of ["ALPHA", "BETA", "GAMMA"]) {
      const review = prompts.find((body) => body.model === "reviewer" && JSON.stringify(body).includes(`TASK_${tag}`))!;
      expect(JSON.stringify(review)).toContain(`gate-${tag.toLowerCase()}`);
      expect(JSON.stringify(review)).toContain("required gate passed");
      const gate = events.findIndex((event) => event.kind === "exec" && event.text.includes(`gate-${tag.toLowerCase()}`));
      expect(gate).toBeGreaterThanOrEqual(0);
      expect(gate).toBeLessThan(events.findIndex((event) => event.kind === "model" && event.target === tag && event.text === "reviewer"));
    }
  } finally { releaseAlpha?.(); }
}, 15000);

test("controller restart keeps the exact VM; failed old-worker cleanup blocks new credentials and work", async () => {
  const binding = (await snapshot()).teammates.find((member) => member.id === "ada")!.workspace;
  await daemon.stop(); daemon = await start();
  expect((await snapshot()).teammates.find((member) => member.id === "ada")!.workspace).toEqual(binding);
  cleanupFailure = true;
  const before = events.length;
  const existingVMs = runs.length;
  try {
    const created = (await create("ada", "CLEANUP")).task;
    await until(async () => !["queued", "running"].includes((await task(created.id)).status));
    const finished = await task(created.id);
    expect(finished.status).toBe("failed");
    expect(finished.verified).toBe(false);
    expect(worldWorker("ada")?.expression).toBe("concerned");
    const attempted = events.slice(before);
    expect(attempted.map((event) => event.kind)).toEqual(["cleanup"]);
    expect(attempted[0]?.target).toBe(`galahad-sbx-${(await snapshot()).teammates.find((member) => member.id === "ada")!.workspace!.id}`);
    expect(runs).toHaveLength(existingVMs);
  } finally { cleanupFailure = false; }
}, 10000);

test("removing a worker that has a VM: refused until you say its workspace goes, and only from a device that may destroy one; then both go and the others carry on", async () => {
  const bound = (await snapshot()).teammates.find((member) => member.id === "ada")!.workspace!;
  const vms = docker.running();
  const listed = async () => (await api<{ sandboxes: SandboxView[] }>("sandboxes", {})).sandboxes.map((s) => s.id);
  expect(await listed()).toContain(bound.id);
  // Not without saying so, and then nothing has changed: not even a pause.
  await expect(api("removeTeammate", { id: "ada" })).rejects.toThrow(/409 .*workspace/);
  // A device that may command Team but not destroy a sandbox cannot do it either.
  const commander = await pairDevice("commander", ["chat", "fleet:admin"]);
  const refused = await commander("removeTeammate", { id: "ada", destroyWorkspace: true });
  expect(refused.status).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toContain("sandbox");
  expect((await snapshot()).teammates.find((member) => member.id === "ada")).toMatchObject({ enabled: true, workspace: bound });
  expect(docker.running()).toBe(vms);

  expect(await api("removeTeammate", { id: "ada", destroyWorkspace: true })).toEqual({ removed: { id: "ada", name: "ADA" }, workspace: "destroyed" });
  expect(docker.running()).toBe(vms - 1);
  expect(await listed()).not.toContain(bound.id);
  const after = await snapshot();
  expect(after.teammates.map((member) => member.id)).toEqual(["lin"]);
  expect(after.removed).toEqual([{ id: "ada", name: "ADA", removedAt: expect.any(Number) }]);
  expect(after.rooms.find((room) => room.id === "vm-forge")!.members).toEqual(["lin"]);
  const { entries } = await api<{ entries: LedgerEntry[] }>("ledger");
  expect(entries.find((e) => e.resource === "team" && e.class === "delete")).toMatchObject({ target: "worker:ada", verdict: "approved", detail: "its VM workspace was destroyed with it" });
  // It has left the SANDBOX at once, and the others are still shown there and still work.
  expect(worldWorker("ada")).toBeUndefined();
  const next = (await create("lin", "BETA")).task;
  await until(async () => !["queued", "running"].includes((await task(next.id)).status));
  expect(await task(next.id)).toMatchObject({ status: "done", verified: true });
  expect(worldWorker("lin")?.expression).toBe("pleased");
  expect(worldWorker("ada")).toBeUndefined();
}, 15000);

test("what became of its VM is asked of the host and said as it was: Docker that cannot say stops the removal, a VM already gone is called gone, and one that was made but never bound is found and destroyed", async () => {
  const ledgered = async (id: string) => (await api<{ entries: LedgerEntry[] }>("ledger")).entries.find((e) => e.resource === "team" && e.class === "delete" && e.target === `worker:${id}`);
  const lin = (await snapshot()).teammates.find((member) => member.id === "lin")!;
  const vms = docker.running();
  // Docker on its host cannot list just now. That is not "it has none": nothing is removed, paused or unbound.
  dockerSilent = true;
  try { await expect(api("removeTeammate", { id: "lin", destroyWorkspace: true })).rejects.toThrow(/503 .*could not list/); } finally { dockerSilent = false; }
  expect((await snapshot()).teammates.find((member) => member.id === "lin")).toMatchObject({ enabled: true, workspace: lin.workspace });
  expect(docker.running()).toBe(vms);
  expect(await ledgered("lin")).toBeUndefined();

  // Its VM was destroyed from Sandboxes beforehand: there is nothing to confirm, and the record says gone, not destroyed.
  await api("destroySandbox", { id: lin.workspace!.id });
  expect(docker.running()).toBe(vms - 1);
  expect(await api("removeTeammate", { id: "lin" })).toEqual({ removed: { id: "lin", name: "LIN" }, workspace: "gone" });
  expect(await ledgered("lin")).toMatchObject({ verdict: "approved", detail: "its VM was already gone from its host" });

  // A VM made just before a crash, its binding never written: the worker looks unbound, and its VM is still there.
  await api("saveTeammate", { id: "sam", name: "SAM", role: "engineer" });
  const made = (await api<{ workspace: SandboxView }>("provisionTeammate", { id: "sam" })).workspace;
  await daemon.stop();
  const raw = new Database(join(home.dir, "team.db"));
  const stored = JSON.parse(raw.query<{ value: string }, [string]>("SELECT value FROM team_teammates WHERE id=?").get("sam")!.value);
  raw.query("UPDATE team_teammates SET value=? WHERE id=?").run(JSON.stringify({ ...stored, workspace: null }), "sam");
  raw.close();
  daemon = await start();
  expect((await snapshot()).teammates.find((member) => member.id === "sam")).toMatchObject({ workspace: null, workspaceNode: made.node === "keep" ? daemon.identity.id : expect.any(String) });
  const before = docker.running();
  await expect(api("removeTeammate", { id: "sam" })).rejects.toThrow(/409 .*persistent workspace/);
  expect((await snapshot()).teammates.find((member) => member.id === "sam")).toMatchObject({ enabled: true });
  expect(await api("removeTeammate", { id: "sam", destroyWorkspace: true })).toEqual({ removed: { id: "sam", name: "SAM" }, workspace: "destroyed" });
  expect(docker.running()).toBe(before - 1);
  expect((await api<{ sandboxes: SandboxView[] }>("sandboxes", {})).sandboxes.some((s) => s.id === made.id)).toBe(false);
  expect(await ledgered("sam")).toMatchObject({ detail: "its VM workspace was destroyed with it" });

  // Its VM was on a node that is no longer part of the fleet: nothing there can be asked or touched, and the record says so.
  await api("saveTeammate", { id: "tom", name: "TOM", role: "engineer" });
  await daemon.stop();
  const again = new Database(join(home.dir, "team.db"));
  const toms = JSON.parse(again.query<{ value: string }, [string]>("SELECT value FROM team_teammates WHERE id=?").get("tom")!.value);
  again.query("UPDATE team_teammates SET value=? WHERE id=?").run(JSON.stringify({ ...toms, workspaceNode: "n_departed", workspace: { node: "n_departed", id: "0123456789" } }), "tom");
  again.close();
  daemon = await start();
  const stillThere = docker.running();
  expect(await api("removeTeammate", { id: "tom" })).toEqual({ removed: { id: "tom", name: "TOM" }, workspace: "left" });
  expect(docker.running()).toBe(stillThere);
  expect(await ledgered("tom")).toMatchObject({ detail: "its VM was on a node that has left the fleet; nothing there was touched" });
  expect((await snapshot()).removed?.map((member) => member.id).sort()).toEqual(["ada", "lin", "sam", "tom"]);
}, 20000);
