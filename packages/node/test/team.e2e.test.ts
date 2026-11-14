import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAvatar, routes, teamArmLabel, type LedgerEntry, type RouteName, type TeamSnapshot, type TeamRoomView } from "@galahad/core";
import { foundFleet, MindStore } from "@galahad/mind";
import { startDaemon, type Daemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";
import type { Capabilities } from "../src/capabilities.ts";

const root = mkdtempSync(join(tmpdir(), "galahad-team-e2e-"));
const home = new Home(join(root, "node"));
const freePort = () => { const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }); const p = s.port!; s.stop(true); return p; };
const port = freePort();
const caps: Capabilities = { os: "linux", arch: "x64", hostname: "team-test", cores: 4, cpu: "test", memoryGb: 8, hasBattery: false, gpu: [], docker: false, vm: { kvm: false, tools: [] }, tools: [], localModels: [], tailscale: null };
let daemon: Daemon;
let calls = 0;
const prompts: any[] = [];
const model = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
  prompts.push(await req.json()); calls++;
  const delta = calls === 1
    ? { tool_calls: [{ index: 0, id: "shared-note", function: { name: "remember", arguments: JSON.stringify({ text: "The Roundtable shares verified lessons.", tags: ["team-test"] }) } }] }
    : { content: "A useful contribution." };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: calls === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const request = (name: RouteName, input?: unknown, token = home.adminToken()) => fetch(`http://127.0.0.1:${port}${routes[name].path}`, { method: routes[name].method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: routes[name].method === "POST" ? JSON.stringify(input ?? {}) : undefined });
async function api<T = any>(name: RouteName, input?: unknown): Promise<T> { const r = await request(name, input); const body = await r.json(); if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(body)}`); return body as T; }
const start = () => startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {}, shutdownGraceMs: 100 });
beforeAll(async () => {
  const { identity, keystore } = await home.createIdentity("file"); const mind = new MindStore(home.mindPath);
  const fleet = foundFleet(mind, identity, { fleetName: "roundtable", nodeName: "keep" }); mind.close();
  home.writeConfig({ v: 1, name: "keep", fleet, port, keystore, advertise: "127.0.0.1" });
  daemon = await start();
  await api("setProvider", { id: "stand-in", kind: "openai", baseUrl: `http://127.0.0.1:${model.port}/v1` });
  await api("setRoster", { role: "planner", models: ["stand-in/m"] });
});
afterAll(async () => { await daemon?.stop(); model.stop(true); rmSync(root, { recursive: true, force: true }); });

test("real API: squires converse autonomously under a shared bound and write to the same mind", async () => {
  for (const id of ["ada", "lin"]) await api("saveTeammate", { id, name: id.toUpperCase(), role: "planner" });
  await api("saveTeamRoom", { id: "forge", name: "Forge", members: ["ada", "lin"], turnBudget: 3 });
  await api("postTeamMessage", { room: "forge", text: "Coordinate on the project together." });
  let state: TeamSnapshot = await api("team");
  for (let n = 0; n < 200 && state.deliveries.some((d) => d.status === "queued" || d.status === "running"); n++) { await Bun.sleep(5); state = await api("team"); }
  expect(state.deliveries.some((d) => d.status === "queued" || d.status === "running")).toBe(false);
  expect(state.deliveries.filter((d) => d.status === "failed")).toEqual([]);
  const room = await api<TeamRoomView>("teamRoom", { id: "forge" });
  expect(room.messages[0]?.speaker).toBe("owner");
  expect(room.messages.filter((m) => m.speaker !== "owner")).toHaveLength(3);
  expect(new Set(room.messages.map((m) => m.speaker))).toEqual(new Set(["owner", "ada", "lin"]));
  expect(state.teammates.reduce((n, m) => n + m.turnsToday, 0)).toBe(3);
  const shared = daemon.store.recall("Roundtable shares", 8).find((m) => m.text.includes("verified lessons"));
  expect(shared?.trust).toBe("agent");
  expect(daemon.store.event(shared!.id)?.prov?.source).toMatch(new RegExp(`^arm:(${["ada", "lin"].map((id) => teamArmLabel(daemon.identity.id, id).replace(/\./g, "\\.")).join("|")})$`));
  // What a knight is told of the others: fellows at one table, none beneath another, the best suited takes the task.
  expect(prompts.some((p) => JSON.stringify(p).includes("a knight of your liege's Roundtable, with a lasting job and a voice of your own. Galahad is his first knight and your fellow, not your master"))).toBe(true);
  expect(prompts.some((p) => JSON.stringify(p).includes("the Roundtable is a technocracy, where the one best suited to a task takes it"))).toBe(true);
  expect(prompts.some((p) => /hivemind|sub-Galahad/i.test(JSON.stringify(p)))).toBe(false);
  expect(prompts.flatMap((p) => p.tools ?? []).map((t: any) => t.function?.name)).not.toContain("bank_accounts");
}, 10000);

test("team owner routes reject external arms, spoofed speakers and fake VM availability", async () => {
  const { token } = await api("mintArm", { label: "outsider", scopes: ["chat", "mind:read", "sandbox"] });
  expect((await request("team", undefined, token)).status).toBe(403);
  expect((await request("postTeamMessage", { room: "forge", text: "forged", speaker: "ada" })).status).toBe(400);
  expect((await request("prepareTeamWorkspace", { id: "0123456789", quest: "arm.team.ada" }, token)).status).toBe(403);
  const unavailable = await request("provisionTeammate", { id: "ada" });
  expect(unavailable.status).toBe(424);
  expect((await api<TeamSnapshot>("team")).teammates.find((m) => m.id === "ada")?.workspace).toBeNull();
  expect((await request("mintArm", { label: "team.ada" })).status).toBeGreaterThanOrEqual(400);
});

test("squires, notes, rooms and messages survive a controller restart", async () => {
  await api("teamMemory", { id: "ada", text: "Working context for the ongoing build." });
  const avatar = { ...defaultAvatar("ada"), form: "round" as const, color: "#b9dfd4", accessory: "plume" as const };
  const saved = await api("saveTeammate", { id: "ada", name: "ADA", avatar });
  expect(saved.teammate.avatar).toEqual(avatar);
  expect(saved.teammate.role).toBe("planner");
  expect((await request("saveTeammate", { id: "ada", name: "ADA", avatar: { ...avatar, color: "url(https://untrusted.example/avatar.svg)" } })).status).toBe(400);
  expect((await request("saveTeammate", { id: "ada", name: "ADA", avatar: { ...avatar, imageUrl: "javascript:alert(1)" } })).status).toBe(400);
  const before = await api<TeamRoomView>("teamRoom", { id: "forge" });
  await daemon.stop(); daemon = await start();
  expect((await api<TeamRoomView>("teamRoom", { id: "forge" })).messages).toEqual(before.messages);
  const persisted = (await api<TeamSnapshot>("team")).teammates.find((m) => m.id === "ada");
  expect(persisted?.memory).toContain("ongoing build");
  expect(persisted?.avatar).toEqual(avatar);
});

test("real API: you remove a squire, nobody else can; it is gone from the team and what it said stays its own", async () => {
  await api("saveTeammate", { id: "temp", name: "Temp", role: "planner" });
  const { token } = await api("mintArm", { label: "remover", scopes: ["chat", "mind:read", "mind:write", "sandbox"] });
  expect((await request("removeTeammate", { id: "temp" }, token)).status).toBe(403);
  // Nor has anyone else a squire's VM made again: an agent is refused on your route and on its host's, and no
  // agent can be given the scope that both need.
  expect((await request("remakeTeammate", { id: "temp" }, token)).status).toBe(403);
  expect((await request("remakeTeamWorkspace", { id: "0123456789", quest: "arm.team.abcdef0123.temp", providers: [] }, token)).status).toBe(403);
  expect((await request("mintArm", { label: "overreach", scopes: ["fleet:admin", "sandbox"] })).status).toBe(400);
  expect((await request("removeTeammate", { id: "temp", keepWorkspace: true })).status).toBe(400);
  expect((await request("removeTeammate", { id: "nobody" })).status).toBe(404);
  expect((await api<TeamSnapshot>("team")).teammates.map((m) => m.id)).toEqual(["ada", "lin", "temp"]);

  expect(await api("removeTeammate", { id: "lin" })).toEqual({ removed: { id: "lin", name: "LIN" }, workspace: "none" });
  const state = await api<TeamSnapshot>("team");
  expect(state.teammates.map((m) => m.id)).toEqual(["ada", "temp"]);
  expect(state.removed).toEqual([{ id: "lin", name: "LIN", removedAt: expect.any(Number) }]);
  expect(state.rooms.find((r) => r.id === "forge")!.members).toEqual(["ada"]);
  const room = await api<TeamRoomView>("teamRoom", { id: "forge" });
  expect(room.messages.some((m) => m.speaker === "lin" && m.speakerName === "LIN")).toBe(true);
  // Removed is for good: not again, not written to, and its handle is nobody else's.
  expect((await request("removeTeammate", { id: "lin" })).status).toBe(410);
  expect((await request("directTeammate", { id: "lin" })).status).toBe(410);
  expect((await request("saveTeammate", { id: "lin", name: "Lin again" })).status).toBe(409);
  // It is on record that you did it.
  const { entries } = await api<{ entries: LedgerEntry[] }>("ledger");
  expect(entries.find((e) => e.resource === "team" && e.class === "delete")).toMatchObject({ target: "worker:lin", verdict: "approved", detail: "it had no workspace" });
  // And it stays so across a restart.
  await daemon.stop(); daemon = await start();
  const again = await api<TeamSnapshot>("team");
  expect(again.teammates.map((m) => m.id)).toEqual(["ada", "temp"]);
  expect(again.removed?.map((m) => m.id)).toEqual(["lin"]);
});
