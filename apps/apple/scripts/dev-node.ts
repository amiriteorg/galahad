#!/usr/bin/env bun
/*
 * A throwaway node to run the Apple app against, started as apps/web/measure/first-load.ts starts one: a temp home, the
 * file keystore, startDaemon with a proxyPort (the app comes in as a phone does behind `tailscale serve`), a stand-in
 * Docker and stand-in models. Nothing leaves this machine, and ~/.galahad is never touched.
 *
 * It seats knights at work (one running a task, one thinking, one whose task was verified, one whose task failed, one
 * paused), has an agent ask your leave for an outward call, and has Galahad ask for a key. Then it makes a client invite
 * and prints its link: paste it into the app. The stand-in streams Galahad's answer a word at a time; asked to show
 * something, his answer holds everything an answer can (headings, a list, a table, code, a chart, figures, steps, a page,
 * choices).
 *
 * Pairing waits for you as a node does: the app's request is printed with its code, and approved only once you write
 * that code into <dir>/approve (`echo 482913 > <dir>/approve`), having compared it with the app's.
 *
 *   bun apps/apple/scripts/dev-node.ts [--dir <dir>]    (SIGINT or SIGTERM stops it and deletes its home)
 *
 * <dir> (default: a new temp directory, printed) receives invite.txt, and pairing.txt while a request waits. The node's
 * home is made inside it too, so a run that is killed outright leaves its home there, not in the system's temp folder.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "../../../packages/core/src/index.ts";
import { foundFleet, MindStore } from "../../../packages/mind/src/index.ts";
import { startDaemon } from "../../../packages/node/src/daemon.ts";
import { Home } from "../../../packages/node/src/home.ts";
import { fakeDocker } from "../../../packages/node/test/fake-docker.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
// The node's key goes to a file in the temp home, never to the OS keychain.
process.env.GALAHAD_KEYSTORE = "file";
const chosen = flag("dir");
if (chosen) mkdirSync(chosen, { recursive: true });
const tmp = mkdtempSync(join(chosen ?? tmpdir(), "galahad-apple-node-"));
const dir = chosen ?? join(tmp, "out");
mkdirSync(dir, { recursive: true });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const freePort = (): number => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
};
const say = (line: string) => console.log(`[dev-node] ${line}`);

let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
const servers: { stop(force?: boolean): unknown }[] = [];
const held: (() => void)[] = [];
let stopping = false;
async function tidy(): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const release of held.splice(0)) release();
  for (const server of servers) server.stop(true);
  await daemon?.stop().catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => void tidy().finally(() => process.exit(0)));

// ---------- the node ----------
const home = new Home(join(tmp, "home"));
const port = freePort();
const { identity, keystore } = await home.createIdentity("file");
if (keystore !== "file") throw new Error(`the node's key went to the ${keystore} keystore, not a file`);
const mind = new MindStore(home.mindPath);
const fleet = foundFleet(mind, identity, { fleetName: "camelot", nodeName: "keep" });
mind.close();
home.writeConfig({ v: 1, name: "keep", fleet, port, keystore, advertise: "127.0.0.1" });
const caps = { os: "linux", arch: "x64", hostname: "keep", cores: 16, cpu: "stand-in", memoryGb: 32, hasBattery: false, gpu: [], docker: true, vm: { kvm: true, tools: ["kata"] }, tools: ["docker"], localModels: [], tailscale: null, sandbox: { image: true, networks: true, vm: true } };
// Ada's task stays at its first command, so one knight is always at work; Percival's answer never comes, so one is always
// thinking. Gareth's gate can't run in its VM.
const docker = fakeDocker();
const hold = new Promise<void>((release) => held.push(release));
let adaAtWork = false;
docker.onExec = async (_container: string, command: string[]) => {
  const text = command.join("\n");
  if (text.includes("write-sync")) {
    adaAtWork = true;
    await hold;
  }
  if (text.includes("gate-fail")) return { code: 1, stdout: "", stderr: "error: connect ECONNREFUSED 127.0.0.1:5432" };
  return { code: 0, stdout: text.includes("gate-") ? "required gate passed" : "command completed" };
};

// ---------- stand-in models ----------
const GALAHAD = "Good evening. This is a stand-in model on a throwaway node, so the words are canned, but they stream to you as a real model's would: a word at a time, into this bubble, until the answer is done.";
// Asked to show something, he answers with everything an answer can hold: what the app draws beyond plain words.
const SHOWN = [
  "## What I found",
  "",
  "Three things stand out, and **one needs you**:",
  "",
  "1. The *release* is on track.",
  "2. CI on `main` is green: https://github.com/amiriteorg/galahad/actions.",
  "3. ~~Friday~~ Monday is the new date.",
  "   - It moved for the review.",
  "",
  "> The gate held: nothing ships unreviewed.",
  "",
  "| Check | Result | Time |",
  "|:--|:--:|--:|",
  "| Unit tests | passed | 41 s |",
  "| Review | passed | 2 min |",
  "",
  "```ts",
  "const ok = await verify(change);",
  "if (!ok) throw new Error(\"held\");",
  "```",
  "",
  "```chart",
  JSON.stringify({ type: "line", title: "Tokens a task", unit: "k", labels: ["Mon", "Tue", "Wed", "Thu", "Fri"], series: [{ name: "Before", values: [442, 430, 451, 438, 440] }, { name: "After", values: [258, 250, 262, 249, 255] }] }),
  "```",
  "",
  "```stats",
  JSON.stringify([{ label: "Read from a cache", value: "73%", delta: 71, note: "since Monday", good: "up" }, { label: "Cost a task", value: 0.54, unit: "$", delta: -0.51, good: "down" }]),
  "```",
  "",
  "```steps",
  JSON.stringify([{ text: "Read the failing test", state: "done" }, { text: "Fix the parser", state: "doing" }, { text: "Ship it", state: "todo" }]),
  "```",
  "",
  "```artifact",
  "<!doctype html><title>Release board</title><style>body{font:16px system-ui;margin:16px;color:#222}h1{font-size:20px}button{font:inherit;padding:8px 14px}</style><h1>Release board</h1><p id=state>3 of 4 checks are green.</p><button onclick=\"document.getElementById('state').textContent='Its script ran.'\">Run its script</button>",
  "```",
  "",
  "Shall I go ahead?",
  "",
  "```choices",
  JSON.stringify(["Ship it", "Hold until Monday"]),
  "```",
].join("\n");
const stream = (text: string, delayMs: number): Response => {
  const encoder = new TextEncoder();
  const words = text.split(/(?<= )/);
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const word of words) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`));
          if (delayMs) await sleep(delayMs);
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
};
const model = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 255,
  fetch: async (request) => {
    const body = (await request.json()) as { model: string; tools?: unknown[]; messages: { role: string; content: unknown }[] };
    const turns = body.messages.filter((message) => message.role !== "system");
    if (JSON.stringify(turns).includes("Take your time")) await hold;
    const goal = JSON.stringify(turns[0] ?? "");
    if (goal.includes("TASK_")) {
      let text = "1. Make the change.\n2. Run the required gate.\nDone when: the gate and independent review pass.";
      const write = goal.includes("TASK_KEEP") ? "write-keep" : "write-sync";
      if (body.model === "engineer") {
        if (goal.includes("TASK_FAIL")) text = "GIVE UP\nThe gate needs a Postgres this VM does not have: `bun test db/` exits 1 before any work, with ECONNREFUSED on 127.0.0.1:5432.";
        else text = turns.some((message) => message.role === "assistant") ? "DONE\nVerified." : `\`\`\`sh\nprintf done > result.txt # ${write}\n\`\`\``;
      } else if (body.model === "reviewer") text = "PASS\nThe required gate passed and execution evidence supports the result.";
      return stream(text, 0);
    }
    // Galahad himself answers with his tools at hand; a knight's reply in a room comes quickly.
    const asked = JSON.stringify(turns.filter((message) => message.role === "user").at(-1) ?? "");
    if (Array.isArray(body.tools) && body.tools.length) return stream(/\bshow\b/i.test(asked) ? SHOWN : GALAHAD, /\bshow\b/i.test(asked) ? 15 : 70);
    return stream("Understood. I will take the part that is mine and say when it is done.", 0);
  },
});
servers.push(model);
// Where the agent's outward call would go, were it approved.
const upstream = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ ok: true }) });
servers.push(upstream);

// ---------- start ----------
const proxyPort = freePort();
const started = await startDaemon(home, {
  capabilities: caps,
  proxyPort,
  log: () => {},
  docker: docker.runner,
  measure: async (reason, body, limit) => {
    const threads = core.ceilingThreads(body, limit);
    return { at: Date.now(), tookMs: 1, reason, body: core.bodyFingerprint(body, limit), cpu: { single: core.REFERENCE_SINGLE, multi: core.REFERENCE_SINGLE * threads, threads, kernel: core.KERNEL } };
  },
  loopIntervalMs: 3_600_000,
  defaultHeartbeat: false,
  archiveIntervalMs: false,
  shutdownGraceMs: 100,
});
daemon = started;
const routes = core.routes as Record<string, { method: string; path: string }>;
const call = async (token: string, name: string, input?: unknown): Promise<any> => {
  const route = routes[name]!;
  const response = await fetch(`http://127.0.0.1:${port}${route.path}`, {
    method: route.method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
  const answer = await response.json();
  if (!response.ok) throw new Error(`${name}: ${response.status} ${JSON.stringify(answer)}`);
  return answer;
};
const admin = (name: string, input?: unknown) => call(home.adminToken(), name, input);
const until = async (what: string, probe: () => unknown | Promise<unknown>, timeoutMs = 45_000): Promise<void> => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await probe()) return;
    await sleep(100);
  }
  throw new Error(`waited ${timeoutMs / 1000} s for ${what}`);
};

await until("the node's calibration", () => started.store.lww(`calibration:${started.identity.id}`) !== null);
await admin("setProvider", { id: "stand-in", kind: "openai", baseUrl: `http://127.0.0.1:${model.port}/v1` });
for (const role of ["planner", "engineer", "reviewer", "swift"]) await admin("setRoster", { role, models: [`stand-in/${role}`] });

// ---------- the Roundtable ----------
const knights = [
  { id: "ada", name: "Ada", role: "engineer", instructions: "Builds the sync engine and keeps its tests green." },
  { id: "kay", name: "Kay", role: "planner", instructions: "Breaks large work into tasks that can be checked." },
  { id: "percival", name: "Percival", role: "planner", instructions: "Researches the questions the others park." },
  { id: "gareth", name: "Gareth", role: "engineer", instructions: "Keeps the database layer and its migrations honest." },
  { id: "bors", name: "Bors", role: "reviewer", instructions: "Reviews what the others ship, independently.", enabled: false },
  { id: "gawain", name: "Gawain", role: "engineer", instructions: "Works the web through a browser: signs in, downloads, checks pages." },
];
for (const knight of knights) await admin("saveTeammate", knight);
await admin("setComputeLimit", { node: started.identity.id, cores: 16, memoryGb: 32, sandboxes: 6 });
const ended = (id: string) => async () => !["queued", "running"].includes((await admin("team")).tasks.find((t: { id: string }) => t.id === id)?.status ?? "queued");
const own: Record<string, string> = {};
for (const id of ["ada", "kay", "percival", "gareth"]) own[id] = (await admin("directTeammate", { id })).room.id;
await admin("createTeamTask", { room: own.ada, assignee: "ada", title: "Sync survives a dropped connection", goal: "TASK_SYNC: make sync resume after a dropped connection, with a test that drops it.", dependsOn: [], gates: ["test -f result.txt # gate-sync"] });
await until("Ada's task to start", () => adaAtWork);
const kept = (await admin("createTeamTask", { room: own.kay, assignee: "kay", title: "The importer reads ISO dates", goal: "TASK_KEEP: make the importer read ISO 8601 dates as well as the day-first form, with tests.", dependsOn: [], gates: ["bun test importer # gate-keep"] })).task;
await until("Kay's task to end", ended(kept.id));
const failing = (await admin("createTeamTask", { room: own.gareth, assignee: "gareth", title: "Migrations run on a fresh database", goal: "TASK_FAIL: make every migration run on a fresh database, with a test.", dependsOn: [], gates: ["bun test db/ # gate-fail"] })).task;
await until("Gareth's task to end", ended(failing.id));
await admin("postTeamMessage", { room: own.percival, text: "Take your time: what do other agents do about context rot?" });
await until("Percival to start thinking", async () => (await admin("team")).deliveries.some((d: { status: string; teammate: string }) => d.teammate === "percival" && d.status === "running"));

// ---------- what needs you ----------
// An agent asks your leave for an outward call (a connector's post), and Galahad asks for a key.
const forge = { id: "forge", label: "Forge", origin: `http://127.0.0.1:${upstream.port}`, auth: { secret: "forge", scheme: "bearer" }, tools: { post: { description: "Post publicly.", method: "POST", path: "/posts", params: { text: { type: "string", required: true } }, class: "outward" } } };
await admin("setConnector", { id: "forge", manifest: forge });
await admin("setSecret", { name: "forge", value: "fake-forge-key-for-tests-only", provider: "forge" });
const { token: bot } = await admin("mintArm", { label: "release-bot", scopes: ["connect"] });
const asked = await call(bot, "callConnector", { connector: "forge", tool: "post", args: { text: "Galahad 0.4: sync survives a dropped connection." }, why: "Announce the release once its checks pass." });
if (asked.status !== "asked") throw new Error(`the agent's call wasn't held for you: ${JSON.stringify(asked)}`);
await admin("requestSecret", { name: "github-token", purpose: "To open the pull request for the sync fix." });

// ---------- pairing ----------
const origin = `http://127.0.0.1:${proxyPort}`;
const invite = await admin("createInvite", { kind: "client", origin, scopes: core.CLIENT_DEFAULT_SCOPES });
writeFileSync(join(dir, "invite.txt"), `${invite.url}\n`);
say(`node keep (fleet camelot) at ${origin}`);
say(`invite: ${invite.url}`);
say(`(also in ${join(dir, "invite.txt")}; approve a request with: echo <code> > ${join(dir, "approve")})`);

// A second device asks too once the app is in, so the app's Inbox has a device to answer: a fake key, a code of its own.
let appPaired = false;
const approveFile = join(dir, "approve");
const seen = new Set<string>();
for (;;) {
  const { pairings } = (await admin("pairings")) as { pairings: core.PairingView[] };
  for (const pending of pairings) {
    if (!seen.has(pending.device)) {
      seen.add(pending.device);
      say(`pairing request: "${pending.name}" (${pending.kind}) shows ${pending.sas}`);
      if (!appPaired) writeFileSync(join(dir, "pairing.txt"), `${pending.sas}\n`);
    }
  }
  if (!appPaired && existsSync(approveFile)) {
    const code = readFileSync(approveFile, "utf8").replace(/\D/g, "");
    unlinkSync(approveFile);
    const match = pairings.find((pending) => pending.sas.replace(/\s/g, "") === code);
    if (!match) say(`no request shows ${code}: nothing approved`);
    else {
      await admin("approvePairing", { invite: match.invite, device: match.device });
      appPaired = true;
      rmSync(join(dir, "pairing.txt"), { force: true });
      say(`approved "${match.name}" (${match.device.slice(0, 10)}…)`);
      const second = core.decodeInvite((await admin("createInvite", { kind: "client" })).invite);
      const { p256 } = (await import(Bun.resolveSync("@noble/curves/nist.js", join(import.meta.dir, "../../../packages/core/src")))) as typeof import("../../../packages/core/node_modules/@noble/curves/nist.js");
      const fields: core.PairRequestFields = { invite: second.i, device: core.clientIdFromKey(p256.getPublicKey(p256.utils.randomSecretKey(), false)), name: "Galahad app on iPad", kind: "client" };
      const response = await fetch(`${origin}/link/pair/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fields, proof: core.pairProof(core.fromB64u(second.s), fields) }) });
      say(`a second device asks to join: ${response.status} ${await response.text()}`);
    }
  }
  await sleep(500);
}
