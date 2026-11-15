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
