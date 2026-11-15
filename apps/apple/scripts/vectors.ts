#!/usr/bin/env bun
/*
 * The test vectors the Apple app's Swift tests read (GalahadTests/Fixtures/core-vectors.json), made by packages/core
 * itself, so the app is held to what a node checks: base64url, the device id, request signing, canonical JSON, the
 * pairing math, which drawing a knight wears and what the Roundtable says of each knight (the PWA's own lines). Every
 * vector is checked against core here first: a signature core would refuse never reaches the file.
 *
 * Every key in it is fake: low-entropy, made for these tests and used nowhere else.
 *
 *   bun apps/apple/scripts/vectors.ts           write the file
 *   bun apps/apple/scripts/vectors.ts --check   exit 1 if the file isn't what core makes now
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as core from "../../../packages/core/src/index.ts";
import { galahadNeeds, rosterRows } from "../../web/src/lib/roster.ts";
import { galahadNow, type NowInput } from "../../web/src/lib/now.ts";
import { groupConversations } from "../../web/src/lib/chats.ts";
import { parseMarkdown } from "../../web/src/lib/markdown.ts";
import { detectProvider, detectSignIn, planLine, providerSetup } from "../../web/src/lib/text.ts";
import { desktopAddress, screenPoint, shotSource } from "../../web/src/lib/desktop.ts";
import { PRESETS, SIGN_INS } from "../../../packages/brain/src/providers.ts";
import { timeline, timelineTasks } from "../../web/src/lib/timeline.ts";
import { givenLine, keptChanges, proposedLine, taskActions, taskBadge, taskEnd } from "../../web/src/lib/task-card.ts";
import { removalPlan, teamSpeaker, teammateId } from "../../web/src/lib/team.ts";
import { applyEvent, beginTurn, endTurn, failTurn, turnOf } from "../../web/src/lib/turns.ts";
import { chatStateWords } from "../../../packages/core/src/turns.ts";

// The chats list groups at midnight: UTC here, and in the Swift tests, whatever this machine's own zone is.
process.env.TZ = "UTC";
const OUT = join(import.meta.dir, "../GalahadTests/Fixtures/core-vectors.json");
// The noble the core is built on (its own dependency), for the one thing core leaves to the browser: signing as a phone.
const { p256 } = (await import(Bun.resolveSync("@noble/curves/nist.js", join(import.meta.dir, "../../../packages/core/src")))) as typeof import("../../../packages/core/node_modules/@noble/curves/nist.js");

const { b64u, utf8, fromUtf8 } = core;
const fail = (what: string): never => {
  throw new Error(`vectors: ${what}`);
};
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const bytesOf = (...values: number[]): Uint8Array => new Uint8Array(values);

// ---- base64url ----------------------------------------------------------------------------------------------------
const base64url = {
  encode: [bytesOf(), bytesOf(0), bytesOf(0, 1), bytesOf(0, 1, 2), bytesOf(0xfb, 0xff), bytesOf(0xfb, 0xff, 0xbf), bytesOf(0x3e, 0x3f, 0xfe, 0xff), utf8("Galahad")].map((bytes) => ({ hex: hex(bytes), b64u: b64u(bytes) })),
  decode: ["", "AA", "AAE", "AAEC", "-_8", "A", "AB+C", "AB/C", "AB==", "AB C", "ABCDE"].map((text) => {
    try {
      return { text, hex: hex(core.fromB64u(text)) };
    } catch {
      return { text, hex: null };
    }
  }),
};

// ---- the device: a fake P-256 key, its id, and the id the PWA's WebCrypto export gives -------------------------------
const scalar = new Uint8Array(32).fill(0x11);
const publicKey = p256.getPublicKey(scalar, false);
const device = core.clientIdFromKey(publicKey);
if (!core.isClientId(device)) fail("the fake device id isn't a client id");
// The PWA takes its id from WebCrypto's raw export: the same 65 bytes (0x04, x, y).
const jwk = { kty: "EC", crv: "P-256", x: b64u(publicKey.slice(1, 33)), y: b64u(publicKey.slice(33)), ext: true };
const webKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
if (core.clientIdFromKey(new Uint8Array(await crypto.subtle.exportKey("raw", webKey))) !== device) fail("WebCrypto's raw export gives another id");
// And what WebCrypto signs (IEEE P1363 r||s, as the PWA sends it) is what core verifies.
const webPrivate = await crypto.subtle.importKey("jwk", { ...jwk, d: b64u(scalar) }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
const webSigned = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, webPrivate, utf8("probe")));
if (webSigned.length !== 64 || !core.verifyDeviceSignature(device, webSigned, utf8("probe"))) fail("core doesn't verify what WebCrypto signs");

// ---- request signing ------------------------------------------------------------------------------------------------
const ORDER = p256.Point.Fn.ORDER;
const requests = [
  { method: "GET", path: "/api/whoami", ts: "1763200000000", nonce: b64u(bytesOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)), body: "" },
  { method: "GET", path: "/api/team?probe=1", ts: "1763200000001", nonce: "nonce-for-tests1", body: "" },
  { method: "post", path: "/api/chat", ts: "1763200000002", nonce: "AAAAAAAAAAAAAAAA", body: JSON.stringify({ role: "planner", save: true, messages: [{ role: "user", content: "Hvad så, Galahad? 🛡️ «quoted» \\ \n" }] }) },
  { method: "POST", path: "/api/secrets", ts: "1763200000003", nonce: "_-_-_-_-_-_-_-_-", body: JSON.stringify({ name: "github-token", value: "not-a-real-key" }) },
].map((request) => {
  const body = utf8(request.body);
  const input = core.requestSigningInput(request.method, request.path, request.ts, request.nonce, body);
  const signature = p256.sign(input, scalar);
  const parsed = p256.Signature.fromBytes(signature, "compact");
  const high = new p256.Signature(parsed.r, ORDER - parsed.s);
  const highS = high.toBytes("compact");
  const der = parsed.toBytes("der");
  if (!core.verifyDeviceSignature(device, signature, input)) fail(`core refuses the signature for ${request.path}`);
  if (!core.verifyDeviceSignature(device, highS, input)) fail(`core refuses the high-S form for ${request.path}`);
  if (core.verifyDeviceSignature(device, der, input)) fail(`core takes a DER signature for ${request.path}: the format note is wrong`);
  const headers = { [core.AUTH.device]: device, [core.AUTH.ts]: request.ts, [core.AUTH.nonce]: request.nonce, [core.AUTH.sig]: b64u(signature) };
  const proof = core.verifyRequestSignature(new Headers(headers), request.method, request.path, body, Number(request.ts));
  if (proof?.device !== device || proof.nonce !== request.nonce) fail(`core's verifier refuses the headers for ${request.path}`);
  return {
    ...request,
    bodySha256: core.sha256B64u(body),
    signingInput: fromUtf8(input),
    signature: b64u(signature),
    signatureHighS: b64u(highS),
    signatureDer: b64u(der),
    headers,
  };
});

// ---- canonical JSON (what the pairing proof is a MAC over) -----------------------------------------------------------
const canonical = [
  { kind: "client", name: "Galahad app on iPhone", invite: "abc", device: "c_x" },
  { b: "quote \" backslash \\ slash /", a: "tab \t newline \n return \r backspace \b formfeed \f" },
  { z: "nul \u0000 one \u0001 unit separator \u001f delete \u007f", y: "line   paragraph  " },
  { name: "Will’s “iPad” æøå 🛡️", Name: "upper sorts first", "": "empty key" },
].map((value) => ({ value, canonical: core.canonical(value) }));

// ---- pairing ---------------------------------------------------------------------------------------------------------
const secretText = "fake-invite-secret-for-tests-001";
const secret = utf8(secretText);
if (secret.length !== 32) fail("the fake invite secret isn't 32 bytes");
const fleet = b64u(core.sha256Bytes(utf8("a fake fleet, for tests")));
const invite = core.Invite.parse({ v: 1, e: "http://127.0.0.1:7777", f: fleet, i: b64u(utf8("fake-invite-id01")), s: b64u(secret), k: "client" });
const token = core.encodeInvite(invite);
const rawToken = (value: unknown): string => `gi1.${b64u(utf8(JSON.stringify(value)))}`;
const decodeCases = [
  token,
  `http://127.0.0.1:7778/#pair=${token}`,
  `  https://keep.example.ts.net/#pair=${token}\n`,
  `https://keep.example.ts.net/?pair=${token}`,
  `https://keep.example.ts.net/#x=1&pair=${token}`,
  rawToken({ ...invite, k: "node" }),
  rawToken({ ...invite, e: "https://keep.example.ts.net" }),
  `gi2.${token.slice(4)}`,
  rawToken({ ...invite, x: 1 }),
  rawToken({ v: 1, e: invite.e, f: invite.f, i: invite.i, k: invite.k }),
  rawToken({ ...invite, v: 2 }),
  rawToken({ ...invite, e: "not a url" }),
  rawToken({ ...invite, f: "too-short" }),
  rawToken({ ...invite, k: "phone" }),
  rawToken({ ...invite, s: "not base64url!" }),
  `gi1.${b64u(utf8("not json"))}`,
  "gi1.@@@",
  "hello",
  "",
].map((text) => {
  try {
    return { text, invite: core.decodeInvite(text) };
  } catch {
    return { text, invite: null };
  }
});
const names = ["Galahad app on iPhone", "Will’s “iPad” \\ 🛡️"];
const proofs = names.map((name) => {
  const fields: core.PairRequestFields = { invite: invite.i, device, name, kind: "client" };
  if (!core.PairRequestFields.safeParse(fields).success) fail(`the pairing fields for ${name} don't parse`);
  return { name, canonical: core.canonical(fields), proof: core.pairProof(secret, fields) };
});
// More codes, one of them led by a zero (the code keeps it: "048 213", never "48 213").
const codes: { fleet: string; device: string; sas: string }[] = [];
for (let n = 0; codes.length < 6 || !codes.some((code) => code.sas.startsWith("0")); n++) {
  const sas = core.sasCode(secret, `fleet-${n}`, device);
  if (codes.length < 6 || sas.startsWith("0")) codes.push({ fleet: `fleet-${n}`, device, sas });
}
const pairing = {
  secretText,
  invite,
  token,
  url: `http://127.0.0.1:7778/#pair=${token}`,
  decode: decodeCases,
  device,
  proofs,
  sas: core.sasCode(secret, invite.f, device),
  codes,
  statusProof: core.statusProof(secret, invite.i, device),
  approvalProof: core.approvalProof(secret, invite.i, device, invite.f),
};

// ---- which drawing a knight wears -------------------------------------------------------------------------------------
const profile = (color: string, extra: Record<string, unknown> = {}) => ({ v: 1, form: "armored", color, accent: "#2fa36b", eyes: "oval", accessory: "none", temperament: "calm", ...extra });
const looks = [
  { id: "ada", name: "Ada" },
  { id: "lin", name: "Lin" },
  { id: "gareth", name: "Gareth" },
  { id: "x1", name: "gareth the bold" },
  { id: "x2", name: "Sir Kay" },
  { id: "x3", name: "  Percival  " },
  { id: "x4", name: "LANCELOT" },
  { id: "x5", name: "Ada", avatar: core.lookProfile("bors") },
  { id: "x6", name: "Ada", avatar: profile("#BE7153") },
  { id: "x7", name: "Ada", avatar: profile("#4f8fe0") },
  { id: "x8", name: "Ada", avatar: profile("#123456") },
  { id: "x9", name: "Gareth", avatar: profile("#d9a43c") },
  { id: "x10", name: "Ada", avatar: profile("#be7153", { extra: true }) },
  { id: "x11", name: "Ada", avatar: { ...profile("#be7153"), v: "1" } },
  { id: "x12", name: "Ada", avatar: profile("#be7153", { form: "square" }) },
  { id: "percival-2", name: "Nobody" },
  { id: "zz", name: "" },
].map((knight) => ({ ...knight, look: core.avatarLook(knight.id, knight.name, knight.avatar) }));

// ---- the Roundtable's lines (the PWA's own roster) ----------------------------------------------------------------------
const NOW = 1763200000000;
const at = (minutesAgo: number) => NOW - minutesAgo * 60_000;
const knight = (id: string, name: string, extra: Partial<core.Teammate> = {}): core.Teammate => ({
  id, name, instructions: `${name} keeps the build green.\nA second line nobody shows.`, role: "engineer", harness: "native", enabled: true, dailyTurns: 40, turnsToday: 3,
  repository: null, workspaceNode: null, workspace: null, memory: "", createdAt: at(600), updatedAt: at(600), ...extra,
});
const task = (id: string, assignee: string, status: core.TeamWorkStatus, extra: Partial<core.TeamTask> = {}): core.TeamTask => ({
  id: `task-${id.padEnd(12, "0")}`, room: `dm-${assignee}`, assignee, title: `The ${id} task`, goal: "Do it well.", dependsOn: [], gates: [], status, verified: false,
  progress: "", output: "", error: null, chainId: `chain-${id}`, createdAt: at(90), updatedAt: at(30), ...extra,
});
const delivery = (id: string, teammate: string, status: core.TeamWorkStatus, extra: Partial<core.TeamDelivery> = {}): core.TeamDelivery => ({
  id: `delivery-${id}`, room: `dm-${teammate}`, teammate, trigger: "message", chainId: `chain-d-${id}`, status, error: null, createdAt: at(20), updatedAt: at(10), ...extra,
});
const direct = (id: string): core.TeamRoom => ({ id: `dm-${id}`, name: id, members: [id], direct: true, turnBudget: 3, paused: false, createdAt: at(600), updatedAt: at(5) });
const syncTask = task("sync", "ada", "done", { verified: true, updatedAt: at(50) });
const snapshot: core.TeamSnapshot = {
  teammates: [
    knight("ada", "Ada"),
    knight("bea", "Bea"),
    knight("cy", "Cy"),
    knight("dot", "Dot", { enabled: false }),
    knight("eve", "Eve", { turnsToday: 40 }),
    knight("fay", "Fay"),
    knight("gus", "Gus"),
    knight("hal", "Hal", { createdBy: "galahad" }),
    knight("ivy", "Ivy", { createdBy: "hal" }),
    knight("jo", "Jo", { instructions: "", role: "reviewer" }),
    knight("kit", "Kit"),
    knight("lou", "Lou"),
    knight("max", "Max"),
    knight("ned", "Ned", { enabled: false }),
    knight("oz", "Oz"),
    knight("pip", "Pip"),
  ],
  rooms: ["ada", "bea", "cy", "fay", "gus", "kit", "lou", "max", "ned"].map(direct),
  tasks: [
    task("run", "ada", "running", { progress: "Running · bun test packages/link\nmore" }),
    syncTask,
    task("plain", "bea", "running"),
    task("keep", "cy", "done", { verified: true, changes: { artifact: `art_${"a".repeat(22)}`, files: 3, base: "4f7a1c2e9b8d0a1f2e3c4b5a69788796a5b4c3d2" } }),
    task("fail", "fay", "failed", { error: "The gate needs a Postgres this VM doesn't have.\nDetails follow." }),
    task("wait", "gus", "queued", { dependsOn: [task("blocker", "max", "running").id] }),
    task("blocker", "max", "running", { progress: "" }),
    task("halt", "kit", "interrupted"),
    task("stop", "lou", "stopped"),
    task("held", "ned", "queued"),
    task("ask", "oz", "proposed", { proposedBy: "oz" }),
    task("ask2", "oz", "proposed", { proposedBy: "oz", updatedAt: at(40) }),
    task("askpip", "pip", "proposed", { proposedBy: "ada" }),
  ],
  deliveries: [delivery("busy", "bea", "running"), delivery("think", "eve", "queued"), delivery("old", "jo", "failed", { error: "Model unavailable", updatedAt: at(2) })],
};
const asks = [{ by: `arm:team.0123456789.max`, connector: "forge", tool: "post" }, { by: `arm:team.0123456789.max`, connector: "forge", tool: "bucket.delete" }, { by: "loop:morning", connector: "github", tool: "comment" }];
const rows = rosterRows({ snapshot, asks, now: NOW }).filter((row) => row.kind === "knight").map((row) => ({ id: row.id, line: row.line, needs: row.needs }));
const nows: NowInput[] = [
  { turns: [], quests: [], needs: null },
  { turns: [], quests: [], needs: 0 },
  { turns: [], quests: [], needs: 1 },
  { turns: [], quests: [], needs: 3 },
  { step: null, turns: [], quests: [], needs: 2 },
  { step: "Reading packages/link/src/sync.ts", turns: [], quests: [], needs: null },
  { turns: [{ title: "The release plan" }], quests: [], needs: 1 },
  { turns: [{ title: null }], quests: [], needs: 0 },
  { turns: [], quests: [{ goal: "Make sync resume\nafter a drop" }], needs: null },
  { turns: [{ title: "A" }], quests: [{ goal: "B" }], needs: 4 },
];
const roundtable = {
  now: NOW,
  snapshot,
  asks,
  rows,
  galahad: nows.map((input) => ({ input, ...galahadNow(input) })),
  needs: [
    { inbox: 5, knights: snapshot.teammates.map((t) => t.id), needs: galahadNeeds(5, asks, snapshot.teammates.map((t) => t.id)) },
    { inbox: 1, knights: ["max"], needs: galahadNeeds(1, asks, ["max"]) },
  ],
};

// ---- the Roundtable's rooms (the PWA's own roster), in a Roundtable of their own ----------------------------------------
const inRoom = (room: string) => ({ room });
const roomsSnapshot: core.TeamSnapshot = {
  teammates: [knight("ada", "Ada"), knight("bea", "Bea"), knight("cy", "Cy")],
  rooms: [
    { ...direct("ada"), updatedAt: at(1) },
    { id: "studio", name: "Studio", members: ["ada", "bea"], direct: false, turnBudget: 8, paused: false, createdAt: at(600), updatedAt: at(9) },
    { id: "pair", name: "Pair", members: ["ada", "cy"], direct: false, turnBudget: 8, paused: false, createdAt: at(600), updatedAt: at(8) },
    { id: "chatter", name: "Chatter", members: ["ada", "bea", "cy"], direct: false, turnBudget: 8, paused: false, createdAt: at(600), updatedAt: at(7) },
    { id: "talk", name: "Talk", members: ["bea"], direct: false, turnBudget: 8, paused: false, createdAt: at(600), updatedAt: at(7) },
    { id: "broken", name: "Broken", members: ["cy"], direct: false, turnBudget: 8, paused: false, createdAt: at(600), updatedAt: at(6) },
    { id: "cut", name: "Cut", members: ["cy"], direct: false, turnBudget: 8, paused: false, createdAt: at(600), updatedAt: at(5) },
    { id: "failed", name: "Failed", members: ["ada"], direct: false, turnBudget: 8, paused: false, createdAt: at(600), updatedAt: at(4) },
    { id: "held", name: "Held", members: ["ada", "bea"], direct: false, turnBudget: 8, paused: true, createdAt: at(600), updatedAt: at(3) },
    { id: "rest", name: "Rest", members: ["bea"], direct: false, turnBudget: 8, paused: true, createdAt: at(600), updatedAt: at(3) },
    { id: "quiet", name: "Quiet", members: ["ada", "bea", "gone"], direct: false, turnBudget: 8, paused: false, createdAt: at(600), updatedAt: at(2) },
    { id: "asks", name: "Asks", members: ["ada", "bea"], direct: false, turnBudget: 8, paused: false, createdAt: at(600), updatedAt: at(2) },
  ],
  tasks: [
    task("studio1", "ada", "running", inRoom("studio")),
    task("pair1", "ada", "running", inRoom("pair")),
    task("pair2", "cy", "running", inRoom("pair")),
    task("failed1", "ada", "failed", { ...inRoom("failed"), error: "No Postgres here.\nMore." }),
    task("held1", "ada", "queued", inRoom("held")),
    task("held2", "bea", "queued", inRoom("held")),
    task("asks1", "ada", "running", inRoom("asks")),
    task("asks2", "bea", "proposed", { ...inRoom("asks"), proposedBy: "bea" }),
  ],
  deliveries: [
    delivery("c1", "ada", "running", inRoom("chatter")),
    delivery("c2", "bea", "running", inRoom("chatter")),
    delivery("t1", "bea", "running", inRoom("talk")),
    delivery("b1", "cy", "failed", { ...inRoom("broken"), error: "Model unavailable\nretry later" }),
    delivery("x1", "cy", "interrupted", inRoom("cut")),
  ],
};
const rooms = {
  snapshot: roomsSnapshot,
  rows: rosterRows({ snapshot: roomsSnapshot, asks: [], now: NOW }).filter((row) => row.kind === "room").map((row) => ({ id: row.id, line: row.line, needs: row.needs })),
};

// ---- seating and keeping knights (the PWA's forms) --------------------------------------------------------------------
const knightForms = {
  handles: [
    ["Ada", []], ["Owner", []], ["Galahad", []], ["System", ["system-2"]], ["Áda", ["ada", "ada-2"]], ["123", []], ["研究", []],
    ["  Sir   Lancelot du Lac!! ", []], ["Ünïcödé Ñame", []], ["-x-", []], ["A".repeat(40), []], ["a very long name that goes on and on and on", []],
    ["", []], ["🛡️ Shield", []], ["ﬁne ﬂow", []], ["İstanbul", []], ["Straße", []], ["ada", ["ada", "ada-2", "ada-3"]],
  ].map(([name, taken]) => ({ name: name as string, taken: taken as string[], handle: teammateId(name as string, taken as string[]) })),
  removals: [
    { workspace: false, workspaceNode: false, maySandbox: true },
    { workspace: false, workspaceNode: false, maySandbox: false },
    { workspace: true, workspaceNode: true, maySandbox: true },
    { workspace: true, workspaceNode: true, maySandbox: false },
    { workspace: false, workspaceNode: true, maySandbox: true },
    { workspace: false, workspaceNode: true, maySandbox: false },
  ].map((c) => ({ ...c, id: "ada", name: "Ada", plan: removalPlan({ id: "ada", name: "Ada", workspace: c.workspace ? { node: "n1", id: "0123456789" } : null, workspaceNode: c.workspaceNode ? "n1" : null }, { sandbox: c.maySandbox }) })),
  profiles: core.AVATAR_LOOKS.flatMap((look) => core.AVATAR_TEMPERAMENTS.map((temperament) => ({ look: look.id, temperament, profile: core.lookProfile(look.id, temperament) }))),
  temperaments: [
    { id: "ada" }, { id: "bors" }, { id: "x" }, { id: "knight-123" }, { id: "percival-2" },
    { id: "ada", avatar: core.lookProfile("bors", "lively") }, { id: "ada", avatar: { ...core.lookProfile("bors", "curious"), extra: 1 } },
  ].map((c) => ({ ...c, temperament: core.resolveAvatar(c.id, c.avatar).temperament })),
};

// ---- keys and the providers they are for (the PWA's own lib/text.ts, over the node's real presets) -----------------------
const fakeKeys = ["sk-ant-api03-FAKE-for-tests", "sk-ant-oat01-FAKE-for-tests", "sk-or-v1-FAKE", "sk-orca-FAKE", "sk-kimi-FAKE", "sk-sp-FAKE", "gsk_FAKE", "plain-FAKE", ""];
const configured = [{ id: "openrouter", kind: "openai" as const, baseUrl: "https://openrouter.ai/api/v1", secret: "openrouter", label: null, hasKey: true }];
const keys = {
  presets: PRESETS,
  signIns: SIGN_INS,
  providers: configured,
  detected: fakeKeys.map((key) => ({ key, provider: detectProvider(key, PRESETS, SIGN_INS), signIn: detectSignIn(key, SIGN_INS) })),
  plans: PRESETS.map((preset) => ({ id: preset.id, line: planLine(preset) })),
  setups: [
    ["anthropic", "anthropic", true], ["zai-coding", "zai-coding", true], ["opencode-go", "opencode-go", true], ["openrouter", "openrouter", true],
    ["openrouter", "openrouter-2", true], ["verda", "verda", true], ["cloudflare-ai", "cf", true], ["mine", "mine", true], ["anthropic", "anthropic", false],
  ].map(([provider, secret, may]) => ({ provider, secret, may, ...providerSetup({ providers: configured, presets: PRESETS }, provider as string, secret as string, may as boolean) })),
};

// ---- a knight's desktop (the PWA's own lib/desktop.ts) ---------------------------------------------------------------
const drawn = { left: 10, top: 20, width: 640, height: 400 };
const desktop = {
  points: [[10, 20], [330, 220], [649.9, 419.9], [650, 420], [9, 20], [10, 421], [100.5, 300.25]].map(([x, y]) => ({ tap: { x, y }, shown: drawn, screen: { width: 1280, height: 800 }, point: screenPoint({ x: x!, y: y! }, drawn, { width: 1280, height: 800 }) })),
  unshown: screenPoint({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 }, { width: 1280, height: 800 }),
  addresses: ["galahad.bot", "https://galahad.bot/x?y=1", "http://localhost:3000", "localhost:3000", "file:///work/index.html", "about:blank", "javascript:alert(1)", "mailto:x@y.z", "two words", "  ", "", `a${"b".repeat(2000)}.com`, "ftp://host"].map((text) => ({ text, address: desktopAddress(text) })),
  shots: [
    { shot: { mediaType: "image/jpeg", data: "/9j/4AAQ" }, width: 1280, height: 800 },
    { shot: { mediaType: "image/png", data: "iVBORw0KGgo=" }, width: 1280, height: 800 },
    { shot: { mediaType: "image/gif", data: "R0lGODlh" }, width: 1280, height: 800 },
    { shot: { mediaType: "image/jpeg", data: "not base64!" }, width: 1280, height: 800 },
    { shot: { mediaType: "image/jpeg", data: "" }, width: 1280, height: 800 },
    { shot: { mediaType: "image/jpeg", data: "/9j/4AAQ" }, width: 0, height: 800 },
  ].map((view) => ({ view, shown: shotSource(view) !== null })),
};

// ---- a chat on screen: kept messages, and a turn's stream applied event by event (the PWA's lib/turns.ts) --------------
const stored = (id: number, role: "user" | "assistant", content: string, extra: Partial<core.StoredMessage> = {}): core.StoredMessage => ({
  id,
  role,
  content,
  model: role === "assistant" ? "stand-in/planner" : null,
  steps: [],
  status: "done",
  error: null,
  createdAt: NOW - 60_000,
  endedAt: NOW - 30_000,
  ...extra,
});
const kept: core.StoredMessage[] = [
  stored(1, "user", "What's on today?"),
  stored(2, "assistant", "The dentist at nine, then **the release**.", {
    steps: [
      { kind: "model", ref: "stand-in/planner" },
      { kind: "archive", entries: [{ id: "ar_1", title: "Calendar", kind: "note", trust: "trusted" }, { id: "ar_2", title: "Mail", kind: "mail", trust: "untrusted" }] },
      { kind: "tool", id: "t1", name: "recall", title: "Searching memory", input: '{"q":"today"}', ok: true, summary: "2 found" },
      { kind: "tool", id: "t2", name: "web_search", title: "Searching the web", input: '{"q":"x"}', ok: false, summary: "refused" },
    ],
  }),
  stored(3, "user", "And tomorrow?"),
  stored(4, "assistant", "", { status: "error", error: "Every model on the roster failed.", steps: [{ kind: "model", ref: "a/b" }, { kind: "fallback", from: "a/b", error: "429" }] }),
  stored(5, "user", "Try again"),
  stored(6, "assistant", "Halfway", { status: "stopped" }),
  stored(7, "user", "Go on"),
  stored(8, "assistant", "First part", { status: "steered" }),
];
type ThreadTurn = import("../../web/src/lib/turns.ts").Turn;
const shown = (turns: ThreadTurn[]) =>
  turns.map((t) => ({
    role: t.role,
    content: t.content,
    status: t.status,
    error: t.error ?? null,
    sid: t.sid ?? null,
    steps: t.steps.map((s) => ({ text: s.text, detail: s.detail ?? null, state: s.state, tool: s.tool ?? null })),
  }));
const freshThread = (): import("../../web/src/lib/turns.ts").Thread => ({ turns: [], nextId: 1, target: null, base: null });
/** A thread from kept messages, then events (null: the stream ends; a string: the watching was cut with it). */
function play(messages: core.StoredMessage[], role: string, question: string | null, events: (core.ChatStreamEvent | null | string)[]) {
  const thread = freshThread();
  for (const m of messages) thread.turns.push(turnOf(m, role, thread.nextId++));
  if (question !== null) beginTurn(thread, question, role, NOW);
  for (const event of events) {
    if (event === null) endTurn(thread, NOW);
    else if (typeof event === "string") failTurn(thread, event, NOW);
    else applyEvent(thread, event, NOW);
  }
  return shown(thread.turns);
}
const turnEvent = (answer: number | null, replay: boolean): core.ChatStreamEvent => ({ type: "turn", id: "tn_1", conversation: "cv_1", answer, role: "planner", startedAt: NOW, deadline: NOW + 1_800_000, replay });
const streamed: { name: string; messages: core.StoredMessage[]; question: string | null; events: (core.ChatStreamEvent | null | string)[] }[] = [
  { name: "kept", messages: kept, question: null, events: [] },
  {
    name: "asked",
    messages: kept.slice(0, 2),
    question: "And the weather?",
    events: [
      turnEvent(9, false),
      { type: "conversation", id: "cv_1", title: "Today", project: null },
      { type: "model", ref: "stand-in/planner" },
      { type: "tool", id: "t3", name: "web_search", title: "Searching the web", input: '{"q":"weather"}' },
      { type: "tool_result", id: "t3", name: "web_search", ok: true, summary: "3 results" },
      { type: "text", text: "Dry " },
      { type: "text", text: "and cold." },
      { type: "usage", ref: "stand-in/planner", usage: null },
      { type: "done", ref: "stand-in/planner" },
      null,
    ],
  },
  {
    name: "fallback-then-error",
    messages: [],
    question: "Hi",
    events: [{ type: "model", ref: "a/b" }, { type: "fallback", from: "a/b", error: "429 slow down" }, { type: "model", ref: "c/d" }, { type: "error", error: "Every model on the roster failed." }, null],
  },
  {
    name: "attached",
    // Loaded while he was answering: the kept answer as it stood, then the node replays the turn from its start.
    messages: [...kept.slice(0, 2), stored(3, "user", "Plan the week"), stored(4, "assistant", "Mon", { status: "streaming", endedAt: null })],
    question: null,
    events: [
      turnEvent(4, true),
      { type: "model", ref: "stand-in/planner" },
      { type: "text", text: "Monday: " },
      { type: "tool", id: "t4", name: "calendar", title: "Reading your calendar", input: "" },
      { type: "tool_result", id: "t4", name: "calendar", ok: false, summary: "no access" },
      { type: "steer", text: "Skip Friday" },
      { type: "text", text: "Done." },
      { type: "stopped", reason: "you" },
      null,
    ],
  },
  { name: "cut", messages: [], question: "Long one", events: [turnEvent(2, false), { type: "model", ref: "x/y" }, { type: "text", text: "Part" }, "The connection to the node dropped."] },
  { name: "steered-before-words", messages: [], question: "Go", events: [{ type: "model", ref: "x/y" }, { type: "steer", text: "Actually, stop" }, { type: "text", text: "OK." }, null] },
];
const threads = streamed.map((s) => ({ ...s, role: "planner", turns: play(s.messages, "planner", s.question, s.events) }));

// ---- the chats list: pinned first, then by when each was last active (lib/chats.ts), at midnight UTC -----------------
const DAY = 86_400_000;
const summary = (id: string, updatedAt: number, pinned = false): core.ConversationSummary => ({
  id,
  title: id,
  project: null,
  role: "planner",
  pinned,
  createdAt: updatedAt - 1000,
  updatedAt,
  count: 2,
  bank: false,
  state: "done",
  queued: 0,
  held: null,
  needs: null,
});
const chatList = [
  summary("pinned-old", NOW - 40 * DAY, true),
  summary("just-now", NOW - 60_000),
  summary("this-morning", NOW - (NOW % DAY) + 60_000),
  summary("yesterday", NOW - (NOW % DAY) - 3_600_000),
  summary("five-days", NOW - 5 * DAY),
  summary("seven-days", NOW - (NOW % DAY) - 6 * DAY - 1),
  summary("last-month", NOW - 31 * DAY),
];
const stateCases: Pick<core.ConversationSummary, "state" | "queued" | "held" | "needs">[] = [
  { state: "done", queued: 0, held: null, needs: null },
  { state: "working", queued: 0, held: null, needs: null },
  { state: "working", queued: 2, held: null, needs: null },
  { state: "waiting", queued: 0, held: null, needs: { approvals: 1, keys: 0, question: false } },
  { state: "waiting", queued: 1, held: "stopped", needs: { approvals: 2, keys: 1, question: true } },
  { state: "waiting", queued: 0, held: null, needs: { approvals: 0, keys: 0, question: true } },
  { state: "waiting", queued: 0, held: null, needs: null },
  { state: "queued", queued: 1, held: null, needs: null },
  { state: "queued", queued: 3, held: "restart", needs: null },
  { state: "queued", queued: 1, held: "device", needs: null },
  { state: "queued", queued: 2, held: "error", needs: null },
  { state: "stopped", queued: 0, held: null, needs: null },
  { state: "failed", queued: 0, held: null, needs: null },
];
const chats = {
  now: NOW,
  list: chatList,
  groups: groupConversations(chatList, NOW).map((g) => ({ label: g.label, ids: g.items.map((c) => c.id) })),
  states: stateCases.map((c) => ({ ...c, words: chatStateWords(c) })),
};

// ---- an answer's words: Markdown read as the PWA reads it (lib/markdown.ts) -------------------------------------------
const markdownCases = [
  "## What I found\n\nThree things stand out, and **one needs you**:\n\n1. The *release* is on track.\n2. CI on `main` is green: https://github.com/amiriteorg/galahad/actions.\n3. ~~Friday~~ Monday is the new date.\n   - It moved for the review.\n\n> The gate held: nothing ships unreviewed.",
  "| Check | Result | Time |\n|:--|:-:|--:|\n| Unit tests | passed | 41 s |\n| Review | `a|b` \\| c |\n| Short |",
  "```ts\nconst ok = await verify(change);\n```\n\n```chart\n{\"type\":\"line\"}\n```\n\n~~~\ntilde fence\n~~~",
  "Still writing:\n\n```python\nprint('half",
  "# One\n###### Six\n####### Seven\n## C#\n## Closed ##",
  "---\n* * *\n___\n- - -\n    ---",
  "3. Third\n4. Fourth\n\n   indented under Fourth\n\n5) Fifth",
  "- a\n  - nested\n    - deeper\n- b\nlazy continuation\n\n- after a blank",
  "> quoted\n> - with a list\n>\n> > and a quote",
  "**bold** __also__ snake_case_name *em* _em_ 2 * 3 * 4 ~~gone~~ ***both***",
  "`code` ``a`b`` ` padded ` `unclosed\n\\*not em\\* \\_ \\# \\[x\\]",
  "[a link](https://example.com/x?y=1) [no](javascript:alert(1)) [rel](/path) [Upper](HTTPS://Example.COM)",
  "See https://example.com/a. And (https://example.com/b), xhttps://not.a.link and HTTP://EXAMPLE.ORG:80/p!",
  "Line one\nline two\r\nline three\rline four",
  "Blåbærgrød på fredag 🛡️ — **fed** *kursiv* `kode` 🎉",
  "<b>raw html stays text</b> & < >",
  "*a\n\nb* stays apart, ** no space ** and *trailing *",
  "",
];
const markdown = markdownCases.map((source) => ({ source, blocks: parseMarkdown(source) }));

// ---- what an answer may show beyond words: core's readers (blocks.ts) ------------------------------------------------
const chartCases = [
  JSON.stringify({ type: "line", title: "Tokens a task", unit: "k", labels: ["Mon", "Tue", "Wed"], series: [{ name: "Before", values: [442, 430, 451] }, { name: "After", values: [258, null, 262] }] }),
  JSON.stringify({ labels: ["A", "B"], series: [{ values: [1, 2] }] }),
  JSON.stringify({ type: "stacked", title: "  Spend\n by   role ", labels: ["Q1", "Q2"], series: [{ name: "Plan", values: [3, 4] }, { name: "Build", values: [5, 6] }] }),
  JSON.stringify({ type: "bar", labels: [1, "Two", "  three  "], series: [{ name: "x", values: [1, 2, 3] }, { values: [4, 5, 6] }] }),
  JSON.stringify({ type: "pie", labels: ["a"], series: [{ values: [1] }] }),
  JSON.stringify({ type: "line", labels: [], series: [] }),
  JSON.stringify({ type: "line", labels: ["a", "b"], series: [{ values: [1] }] }),
  JSON.stringify({ type: "line", labels: ["a"], series: [{ values: ["7"] }] }),
  JSON.stringify({ type: "stacked", labels: ["a"], series: [{ values: [-1] }] }),
  JSON.stringify({ type: "line", labels: ["a"], series: [{ name: "Same", values: [1] }, { name: "same", values: [2] }] }),
  JSON.stringify({ type: "line", labels: ["a"], series: [{ values: [null] }] }),
  JSON.stringify({ type: "line", labels: Array.from({ length: 61 }, (_, i) => `d${i}`), series: [{ values: Array.from({ length: 61 }, () => 1) }] }),
  JSON.stringify({ type: "line", labels: ["a"], series: Array.from({ length: 7 }, (_, i) => ({ name: `s${i}`, values: [i] })) }),
  JSON.stringify({ type: "line", title: "x".repeat(90), unit: "kilometres an hour", labels: ["a".repeat(40)], series: [{ name: "n".repeat(40), values: [1.5] }] }),
  "not json",
  "[1,2]",
];
const statsCases = [
  JSON.stringify([{ label: "Read from a cache", value: "73%", delta: 71, note: "since Monday", good: "up" }, { label: "Cost a task", value: 0.54, unit: "$", delta: -0.51, good: "down" }]),
  JSON.stringify({ stats: [{ label: "Tests", value: 2120 }, { label: "Skipped", value: 13, delta: 0, good: "sideways" }] }),
  JSON.stringify([{ label: "x" }]),
  JSON.stringify([]),
  JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ label: `l${i}`, value: i }))),
  JSON.stringify([{ label: "Infinite", value: 1e400, delta: "3" }]),
];
const choiceCases = [JSON.stringify(["Ship it", "Hold until Monday"]), JSON.stringify({ options: ["Yes", " yes ", "No", 3] }), JSON.stringify(["Only one"]), JSON.stringify(Array.from({ length: 7 }, (_, i) => `c${i}`)), JSON.stringify("text")];
const stepCases = [
  JSON.stringify([{ text: "Read the failing test", state: "done" }, { text: "Fix the parser", state: "doing" }, { text: "Ship it", state: "todo" }, "A bare line", { text: "Odd", state: "maybe" }]),
  JSON.stringify({ steps: [{ text: "failed one", state: "failed" }, { text: "skipped one", state: "skipped" }] }),
  JSON.stringify([{ state: "done" }]),
  JSON.stringify([]),
];
// A page past the limit is written down as how many x's it holds (the test makes it), not as 200,000 characters here.
const artifactCases: (string | { xs: number })[] = ["<!doctype html><title>Q3 &amp; plans</title><p>Hi</p>", "no tags here", { xs: 200_001 }, "<title>  spaced\n title </title>"];
const numbers = [0, 7, 7.256, 42.25, 999.5, 1284, 9999, 10_000, 12_900, 999_999, 1_000_000, 4_200_000, -15_500, 2.5e9, 7e12, 0.054];
const blocks = {
  charts: chartCases.map((text) => ({ text, read: core.readChart(text) })),
  stats: statsCases.map((text) => ({ text, read: core.readStats(text) })),
  choices: choiceCases.map((text) => ({ text, read: core.readChoices(text) })),
  steps: stepCases.map((text) => ({ text, read: core.readSteps(text) })),
  artifacts: artifactCases.map((item) => {
    const read = core.readArtifact(typeof item === "string" ? item : `<p>${"x".repeat(item.xs)}</p>`);
    return { text: typeof item === "string" ? item : null, xs: typeof item === "string" ? null : item.xs, ok: read.ok, why: read.ok ? null : read.why, title: read.ok ? core.artifactTitle(read.value) : null };
  }),
  numbers: numbers.map((n) => ({ n, text: core.compactNumber(n) })),
};

// ---- a knight's timeline: its words and its work, in order (lib/timeline.ts, lib/task-card.ts, lib/team.ts) -----------
const said = (id: string, speaker: string, text: string, minutesAgo: number, speakerName = ""): core.TeamMessage => ({
  id: `msg-${id}`, room: "dm-ada", speaker, speakerName, text, createdAt: at(minutesAgo), chainId: `chain-m-${id}`,
});
const adaMessages = [
  said("1", "owner", "Can you make sync resume after a drop?", 120),
  said("2", "ada", "On it. I'll keep the gate green.", 119, "Ada"),
  said("3", "galahad", "Ada, the release is Monday.", 95),
  said("4", "system", "Ada was given a task by the Roundtable.", 90),
  said("5", "owner", "Thanks!", 10),
  said("6", "bors", "", 5),
];
const adaTasks = [
  task("sync", "ada", "done", { verified: true, createdAt: at(90), output: "Sync now resumes from the last acknowledged event.\n\nReview: PASS", changes: { artifact: `art_${"b".repeat(22)}`, files: 2, base: "4f7a1c2e9b8d0a1f2e3c4b5a69788796a5b4c3d2" } }),
  task("run", "ada", "running", { createdAt: at(30), progress: "Running · bun test packages/link\nmore" }),
  task("same", "ada", "queued", { createdAt: at(30), givenBy: "owner" }),
  task("old", "ada", "failed", { createdAt: at(200), error: "gave-up", output: "Review: FAIL" }),
  task("cut", "ada", "interrupted", { createdAt: at(60) }),
  task("halt", "ada", "stopped", { createdAt: at(40), error: "stopped", givenBy: "galahad" }),
  task("half", "ada", "done", { createdAt: at(20), verified: false, output: "x".repeat(1200) }),
  task("elsewhere", "bea", "running", { createdAt: at(15), room: "room-wckd" }),
  task("roomwork", "bea", "queued", { createdAt: at(12), room: "dm-ada" }),
  task("ask", "ada", "proposed", { createdAt: at(150), proposedBy: "ada" }),
  task("asked", "ada", "running", { createdAt: at(8), proposedBy: "bea" }),
  task("declined", "ada", "stopped", { createdAt: at(7), proposedBy: "ada", error: "Declined by you." }),
];
const adaRoom = { id: "dm-ada", direct: true, members: ["ada"] };
const sharedRoom = { id: "dm-ada", direct: false, members: ["ada", "bea"] };
const timelines = {
  messages: adaMessages,
  tasks: adaTasks,
  knight: timeline(adaMessages, timelineTasks(adaRoom, adaTasks)).map((item) => item.key),
  room: timeline(adaMessages, timelineTasks(sharedRoom, adaTasks)).map((item) => item.key),
  sinceAt: at(100),
  since: timeline(adaMessages, timelineTasks(adaRoom, adaTasks), { since: at(100) }).map((item) => item.key),
  speakers: adaMessages.map((message) => teamSpeaker(message, snapshot.teammates)),
  cards: adaTasks.map((t) => ({ id: t.id, badge: taskBadge(t), end: taskEnd(t), actions: taskActions(t), given: givenLine(t), kept: keptChanges(t)?.text ?? null, proposed: proposedLine(t, t.proposedBy === "ada" ? "Ada" : null) })),
};

// ---- the file ----------------------------------------------------------------------------------------------------------
const vectors = {
  about: "Made by apps/apple/scripts/vectors.ts from packages/core (and the PWA's roster). Every key here is a fake made for these tests.",
  auth: { domain: "galahad-req/v1", headers: core.AUTH, maxSkewMs: core.MAX_REQUEST_SKEW_MS },
  base64url,
  identity: { scalarHex: hex(scalar), publicKey: b64u(publicKey), device },
  requests,
  canonical,
  pairing,
  looks,
  roundtable,
  rooms,
  knightForms,
  keys,
  desktop,
  threads,
  chats,
  markdown,
  blocks,
  timelines,
};
const text = `${JSON.stringify(vectors, null, 2)}\n`;
if (Bun.argv.includes("--check")) {
  let kept = "";
  try {
    kept = readFileSync(OUT, "utf8");
  } catch {
    /* none yet */
  }
  if (kept !== text) {
    console.error(`${OUT} isn't what core makes now: run bun apps/apple/scripts/vectors.ts`);
    process.exit(1);
  }
  console.log("the vectors match core");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}`);
}
