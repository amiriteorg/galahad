import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BoardVersionInfo, type RouteName, routes } from "@galahad/core";
import { foundFleet, MindStore } from "@galahad/mind";
import { BoardStore } from "../src/board.ts";
import { boardVersionForArchive, boardVersionsSince, PICTURE_EVERY_MS } from "../src/board-history.ts";
import type { Capabilities } from "../src/capabilities.ts";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";
import { png } from "./png-fixture.ts";

/*
 * Nothing on the board is ever lost: every version is kept, append-only, with
 * who and when; clearing, erasing and restoring destroy nothing; any version can
 * be read back (its items, its strokes, its picture, its words) or restored; the
 * history survives a crash mid-write and a lost board file; and an archive can
 * take it in by cursor without knowing how it's kept. Only the owner restores
 * or forgets it.
 */

const root = mkdtempSync(join(tmpdir(), "galahad-board-history-"));
let n = 0;
const dir = () => join(root, `b${++n}`);
const clock = { t: 1_000_000 };
const now = () => clock.t;
const stroke = (i: number, more: object = {}) => ({ id: `s_${String(i).padStart(10, "0")}`, color: "white" as const, width: 6, points: [10 + i, 10, 200, 120], ...more });
const ids = (v: { id: string }[]) => v.map((x) => x.id);

describe("every version, kept", () => {
  test("clearing destroys nothing: the version before it reads back whole, with who and when", () => {
    const board = new BoardStore({ dir: dir(), now });
    clock.t += 1000;
    board.draw([stroke(1), stroke(2)], undefined, "iPhone");
    clock.t += 1000;
    const note = board.write({ item: { kind: "note", title: "Plan", text: "- measure" } }, "galahad");
    clock.t += 1000;
    board.clear("iPhone");
    expect(board.view()).toMatchObject({ items: [], strokes: [] });
    const { versions } = board.history.before(null, 10);
    expect(versions.map((v) => [v.version, v.change, v.by, v.device, v.summary])).toEqual([
      [3, "clear", "owner", "iPhone", "cleared the board"],
      [2, "write", "galahad", null, 'wrote a note: "Plan"'],
      [1, "draw", "owner", "iPhone", "drew 2 strokes"],
      [0, "start", "node", null, "the board as it stood when its history began"],
    ]);
    const before = board.history.state(2)!;
    expect(ids(before.state.strokes)).toEqual([stroke(1).id, stroke(2).id]);
    expect(before.state.items).toEqual([note]);
    expect(before.info.at).toBe(1_002_000);
  });

  test("erasing too: what an agent or you erased is still in the version before", () => {
    const board = new BoardStore({ dir: dir(), now });
    const a = board.write({ item: { kind: "text", text: "draft" } }, "galahad");
    board.draw([stroke(1)]);
    board.erase({ items: [a.id] }, { by: "galahad", owner: false });
    board.erase({ strokes: [stroke(1).id] }, { by: "owner", owner: true });
    expect(board.view()).toMatchObject({ items: [], strokes: [] });
    expect(board.history.state(2)!.state).toMatchObject({ items: [a], strokes: [expect.objectContaining({ id: stroke(1).id })] });
    expect(board.history.before(null, 2).versions.map((v) => v.summary)).toEqual(["erased 1 stroke", "erased 1 item"]);
  });

  test("a version restored: back on the board as it stood; what was there is kept too, so a restore can be undone", () => {
    const board = new BoardStore({ dir: dir(), now });
    board.draw([stroke(1)]);
    const first = board.write({ item: { kind: "text", text: "first" } }, "galahad");
    board.write({ item: { kind: "text", text: "second" }, replace: first.id }, "galahad");
    board.draw([stroke(2)]);
    board.clear();
    const { version } = board.restore(2);
    expect(board.view().items).toEqual([first]);
    expect(ids(board.view().strokes)).toEqual([stroke(1).id]);
    expect(board.history.before(null, 1).versions[0]).toMatchObject({ version, change: "restore", summary: "restored version 2" });
    // And back to how it was before the clear.
    board.restore(4);
    expect(board.view().items.map((i) => (i.kind === "text" ? i.text : ""))).toEqual(["second"]);
    expect(ids(board.view().strokes)).toEqual([stroke(1).id, stroke(2).id]);
    expect(() => board.restore(999)).toThrow("no version 999");
  });

  test("the owner's picture: kept at most every two minutes while drawing, and always before anything's wiped; never across a clear", () => {
    const board = new BoardStore({ dir: dir(), now });
    board.draw([stroke(1)], png(320, 180));
    expect(board.history.pictureFor(1)).toBe(1);
    clock.t += 10_000;
    board.draw([stroke(2)], png(320, 180));
    // Too soon to keep another: version 2 shows the picture of version 1 (the nearest before it).
    expect(board.history.pictureFor(2)).toBe(1);
    // Wiping it keeps the latest first.
    board.clear();
    expect(board.history.pictureFor(2)).toBe(2);
    expect(board.history.pictureFor(3)).toBeNull();
    clock.t += PICTURE_EVERY_MS;
    board.draw([stroke(3)], png(320, 180));
    expect(board.history.pictureFor(4)).toBe(4);
    expect(board.history.picture(2)!.png.subarray(1, 4)).toEqual(new TextEncoder().encode("PNG"));
  });

  test("bounded: checkpoints keep any version a short replay; a full segment is sealed (gzipped) and still reads", () => {
    const d = dir();
    const board = new BoardStore({ dir: d, now });
    const big = Array.from({ length: 1000 }, (_, i) => [((i * 37) % 15_990) / 10 + 0.1, ((i * 71) % 8_990) / 10 + 0.1]).flat();
    // About 12 KB a stroke: 200 of them fill more than a 2 MB segment.
    for (let i = 0; i < 200; i++) {
      board.draw([stroke(i, { points: big })]);
      board.erase({ strokes: [stroke(i).id] }, { by: "owner", owner: true });
    }
    const files = readdirSync(join(d, "main.history"));
    expect(files.some((f) => f.endsWith(".jsonl.gz"))).toBe(true);
    // Version 3 (the second stroke on the board) from the sealed segment, after a restart.
    const again = new BoardStore({ dir: d, now });
    expect(ids(again.history.state(3)!.state.strokes)).toEqual([stroke(1).id]);
    expect(again.history.size).toBe(401);
    expect(again.version).toBe(400);
    // 400 changes of 12 KB each, written through to disk: seconds of real work, and more on a busy machine.
  }, 30_000);

  test("a crash mid-write: the half line is skipped and the next change still lands; a lost board file comes back from its history", () => {
    const d = dir();
    const board = new BoardStore({ dir: d, now });
    board.draw([stroke(1)]);
    const active = readdirSync(join(d, "main.history")).find((f) => f.endsWith(".jsonl"))!;
    appendFileSync(join(d, "main.history", active), '{"v":1,"version":2,"at":1,"by":"own');
    const logs: string[] = [];
    const again = new BoardStore({ dir: d, now, log: (m) => logs.push(m) });
    expect(logs.join(" ")).toContain("couldn't be read");
    again.draw([stroke(2)]);
    expect(ids(new BoardStore({ dir: d, now }).history.state(2)!.state.strokes)).toEqual([stroke(1).id, stroke(2).id]);
    // The board's own file lost: rebuilt from the history.
    rmSync(join(d, "main.json"));
    const rebuilt = new BoardStore({ dir: d, now });
    expect(rebuilt.version).toBe(2);
    expect(ids(rebuilt.view().strokes)).toEqual([stroke(1).id, stroke(2).id]);
    // And a file that fails the contract, the same.
    writeFileSync(join(d, "main.json"), '{"v":1,"version":2,"items":"no"}');
    expect(ids(new BoardStore({ dir: d, now }).view().strokes)).toEqual([stroke(1).id, stroke(2).id]);
  });
});

describe("for an archive", () => {
  test("versions since a cursor, oldest first and stable; each with its words and its picture; versions never reused after forgetting", () => {
    const board = new BoardStore({ dir: dir(), now });
    board.draw([stroke(1, { color: "pink" })], png(320, 180), "iPhone");
    board.write({ item: { kind: "equation", text: "E = m*c^2" } }, "galahad");
    let { versions, cursor } = boardVersionsSince(board, null, 2);
    expect(versions.map((v) => v.version)).toEqual([0, 1]);
    ({ versions, cursor } = boardVersionsSince(board, cursor, 10));
    expect(versions.map((v) => v.version)).toEqual([2]);
    expect(boardVersionsSince(board, cursor)).toEqual({ versions: [], cursor: null });
    const two = boardVersionForArchive(board, 2)!;
    expect(two.text).toContain("Chalkboard, version 2");
    expect(two.text).toContain("Galahad wrote an equation");
    expect(two.text).toContain("E = m·c^2");
    expect(two.text).toContain("1 stroke of chalk (1 pink)");
    expect(two.image?.shows).toBe(1);
    expect(boardVersionForArchive(board, 999)).toBeNull();
    expect(() => boardVersionsSince(board, "nonsense")).toThrow("not a board cursor");
    // Forgotten: only the owner's fresh start remains, and the next change is version 3, not a reused number.
    board.forgetHistory("iPhone");
    expect(boardVersionsSince(board, null).versions.map((v: BoardVersionInfo) => [v.version, v.change])).toEqual([[2, "start"]]);
    board.draw([stroke(2)]);
    expect(boardVersionsSince(board, cursor).versions.map((v) => v.version)).toEqual([3]);
  });
});

/* ---------------- the routes: anyone who reads the board reads its history; only you restore or forget ---------------- */

const caps: Capabilities = { os: "linux", arch: "x64", hostname: "board-history", cores: 4, cpu: "test", memoryGb: 8, hasBattery: false, gpu: [], docker: false, vm: { kvm: false, tools: [] }, tools: [], localModels: [], tailscale: null };
const freePort = () => {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const p = s.port!;
  s.stop(true);
  return p;
};
const home = new Home(join(root, "node"));
const port = freePort();
let daemon: Daemon;
let arm = "";
const call = (name: RouteName, input: unknown, token: string) => {
  const route = routes[name];
  return fetch(`http://127.0.0.1:${port}${route.path}`, { method: route.method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined });
};

beforeAll(async () => {
  const { identity, keystore } = await home.createIdentity("file");
  const store = new MindStore(home.mindPath);
  const fleet = foundFleet(store, identity, { fleetName: "camelot", nodeName: "history-node" });
  store.close();
  home.writeConfig({ v: 1, name: "history-node", fleet, port, keystore, advertise: "127.0.0.1" });
  daemon = await startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {} });
  arm = ((await (await call("mintArm", { label: "archivist" }, home.adminToken())).json()) as { token: string }).token;
});
afterAll(async () => {
  await daemon?.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("the history's routes", () => {
  test("an agent reads the history, a version and its picture; it can't restore or forget; you can", async () => {
    const admin = home.adminToken();
    await call("boardDraw", { strokes: [stroke(1)], snapshot: Buffer.from(png(320, 180)).toString("base64") }, admin);
    await call("boardClear", {}, admin);
    const history = (await (await call("boardHistory", { limit: 10 }, arm)).json()) as { versions: BoardVersionInfo[]; more: boolean };
    expect(history.versions.map((v) => [v.change, v.device])).toEqual([
      ["clear", "a terminal on history-node"],
      ["draw", "a terminal on history-node"],
      ["start", null],
    ]);
    const one = (await (await call("boardVersion", { version: 1 }, arm)).json()) as { strokes: unknown[]; text: string };
    expect(one.strokes.length).toBe(1);
    expect(one.text).toContain("drew 1 stroke");
    const picture = await call("boardVersionPicture", { version: 1 }, arm);
    expect([picture.status, picture.headers.get("content-type"), picture.headers.get("x-board-picture-of")]).toEqual([200, "image/png", "1"]);
    expect((await call("boardRestore", { version: 1 }, arm)).status).toBe(403);
    expect((await call("boardForget", {}, arm)).status).toBe(403);
    expect((await call("boardRestore", { version: 1 }, admin)).status).toBe(200);
    expect(daemon.board.view().strokes.length).toBe(1);
    expect((await call("boardForget", {}, admin)).status).toBe(200);
    expect(daemon.board.history.size).toBe(1);
    expect(existsSync(join(home.dir, "boards", "main.history", "pictures"))).toBe(false);
  });
});
