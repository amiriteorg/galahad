import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import {
  BOARD_H,
  BOARD_LIMITS as L,
  BOARD_W,
  type BoardChange,
  BoardFile,
  type BoardItem,
  type BoardSnapshotInfo,
  type BoardStroke,
  type BoardView,
  BoardWriteInput,
  freeSpot,
  itemSummary,
  layoutItem,
  type StrokeInput,
} from "@galahad/core";
import type { z } from "zod";
import { BoardHistory, type Change } from "./board-history.ts";

/*
 * The chalkboard, as the node keeps it: one JSON file per board in the home
 * (`boards/<id>.json`) and the PNG of what the owner last saw beside it
 * (`boards/<id>.png`), each written atomically (a temporary file, then a
 * rename), mode 600. Node-local: it never replicates (the mind is the record
 * of what's decided; the board is a working surface). A file that can't be
 * read or doesn't pass the contract is set aside, never trusted, and the board
 * is rebuilt from its history (or starts clean, with none). Every count and
 * size is capped (BOARD_LIMITS in core).
 *
 * Nothing on it is ever lost: every change is appended to its history first
 * (board-history.ts), so clearing, erasing and restoring destroy nothing, and
 * any version can be read or put back. Only the owner forgets history.
 */

export class BoardError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface BoardStoreOptions {
  dir: string;
  /** One board for now: "main". */
  id?: string;
  now?: () => number;
  log?: (message: string) => void;
  /** Told after every change. */
  onChange?: (change: BoardChange) => void;
  /** The history's own bounds, when not a node's defaults (a test fills a small segment instead of two megabytes). */
  history?: { segmentBytes?: number; checkpointEvery?: number };
}

const newId = (prefix: "s" | "i") => `${prefix}_${randomBytes(9).toString("base64url")}`;
/** Points are kept to a tenth of a board unit: plenty for chalk, and the file stays small. */
const tenth = (v: number) => Math.round(v * 10) / 10;

/** Who changed the board: "owner" (and their device), or an agent's label. */
export interface Who {
  by: string;
  owner: boolean;
  device?: string | undefined;
}
const OWNER: Who = { by: "owner", owner: true };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
type BoardHistoryState = { items: BoardItem[]; strokes: BoardStroke[] };

export class BoardStore {
  readonly path: string;
  readonly pngPath: string;
  private state: z.infer<typeof BoardFile>;
  private readonly now: () => number;
  /** Every version of the board (board-history.ts). */
  readonly history: BoardHistory;
  /** The owner's latest picture has been kept in the history (or there's none to keep). */
  private pictureKept = true;

  constructor(private readonly opts: BoardStoreOptions) {
    const id = opts.id ?? "main";
    if (!/^[a-z0-9-]{1,32}$/.test(id)) throw new Error("a board's id is lowercase letters, digits and -");
    this.path = join(opts.dir, `${id}.json`);
    this.pngPath = join(opts.dir, `${id}.png`);
    this.now = opts.now ?? Date.now;
    this.history = new BoardHistory(join(opts.dir, `${id}.history`), { now: this.now, ...(opts.log ? { log: opts.log } : {}), ...opts.history });
    this.state = this.load();
    const latest = this.history.latest;
    if (latest === null || latest < this.state.version) {
      // Where the history begins: the board as it stands.
      this.history.append({ version: this.state.version, at: this.now(), by: "node", change: "start", summary: "the board as it stood when its history began" }, this.state as BoardHistoryState);
    } else if (latest > this.state.version) {
      // The board's file is behind its history (a crash between the two, or the file was lost): the history wins.
      const found = this.history.state(latest);
      if (found) {
        this.state = { ...this.state, version: latest, updatedAt: found.info.at, items: found.state.items, strokes: found.state.strokes };
        this.opts.log?.(`board: rebuilt version ${latest} from its history`);
        this.save();
      }
    }
  }

  private load(): z.infer<typeof BoardFile> {
    const empty = { v: 1 as const, version: 0, updatedAt: 0, items: [], strokes: [], snapshot: null };
    if (!existsSync(this.path)) return empty;
    try {
      const parsed = BoardFile.parse(JSON.parse(readFileSync(this.path, "utf8")));
      if (parsed.snapshot && !existsSync(this.pngPath)) parsed.snapshot = null;
      return parsed;
    } catch (error) {
      // Never trusted, never lost: set aside for a look, and a clean board in its place.
      const aside = `${this.path}.corrupt-${this.now()}`;
      try {
        renameSync(this.path, aside);
      } catch {
        /* it goes when the next write replaces it */
      }
      this.opts.log?.(`board: ${this.path} couldn't be read (${(error as Error).message.slice(0, 200)}); set aside as ${aside}`);
      // Rebuilt from the history when there is one (the constructor does it); otherwise a clean board, at a
      // version past anything a page could have seen, so every page fetches it.
      return { ...empty, version: this.history.latest === null ? 1 : 0 };
    }
  }

  private save(): void {
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    atomicWrite(this.path, `${JSON.stringify(this.state)}\n`);
  }

  /**
   * One change: its version, appended to the history first (with what it added and
   * took away), then the board's file, then whoever listens told.
   */
  private changed(change: Omit<BoardChange, "version">, record: { who: Who; summary: string; add?: Change["add"]; remove?: Change["remove"] }): void {
    this.state.version++;
    this.state.updatedAt = this.now();
    this.history.append(
      {
        version: this.state.version,
        at: this.state.updatedAt,
        by: record.who.owner ? "owner" : record.who.by,
        device: record.who.owner ? record.who.device : undefined,
        change: change.change,
        summary: record.summary,
        ...(record.add ? { add: record.add } : {}),
        ...(record.remove ? { remove: record.remove } : {}),
      },
      this.state as BoardHistoryState,
    );
    this.save();
    this.opts.onChange?.({ version: this.state.version, ...change });
  }

  /** Before anything is wiped: the owner's latest picture goes into the history, if it isn't there yet. */
  private keepPicture(): void {
    if (this.pictureKept || !this.state.snapshot) return;
    const shot = this.snapshot();
    if (shot) this.history.keepPicture(shot.png, shot.info.version, true);
    this.pictureKept = true;
  }

  get version(): number {
    return this.state.version;
  }

  view(): BoardView {
    const { v: _v, ...view } = this.state;
    return view as BoardView;
  }

  /** The owner's strokes (a stroke already there, by its id, is skipped: a retry adds nothing twice), and the PNG of what they see. */
  draw(strokes: StrokeInput[], snapshot?: Uint8Array, device?: string): { added: number; version: number } {
    const have = new Set(this.state.strokes.map((s) => s.id));
    const fresh = strokes.filter((s, i) => !have.has(s.id) && strokes.findIndex((t) => t.id === s.id) === i);
    const points = this.state.strokes.reduce((n, s) => n + s.points.length / 2, 0) + fresh.reduce((n, s) => n + s.points.length / 2, 0);
    if (this.state.strokes.length + fresh.length > L.strokes || points > L.boardPoints) {
      throw new BoardError(409, "the board is full: erase some of the drawing, or clear the board");
    }
    const png = snapshot ? checkPng(snapshot) : null;
    const at = this.now();
    const added: BoardStroke[] = [];
    for (const s of fresh) {
      added.push({
        id: s.id,
        color: s.color,
        width: tenth(s.width),
        points: s.points.map(tenth),
        ...(s.pressure ? { pressure: s.pressure.map((p) => Math.round(p * 100) / 100) } : {}),
        ...(s.erase ? { erase: true } : {}),
        at,
      });
    }
    this.state.strokes.push(...added);
    if (png) {
      mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
      atomicWrite(this.pngPath, png.bytes);
      // The snapshot shows the board as it is after these strokes; the history keeps one every so often.
      const shows = this.state.version + (fresh.length ? 1 : 0);
      this.state.snapshot = { at, version: shows, width: png.width, height: png.height, bytes: png.bytes.length };
      this.pictureKept = this.history.keepPicture(png.bytes, shows);
    }
    if (!fresh.length) {
      // A snapshot alone changes nothing anyone sees: kept, but no new version.
      if (png) this.save();
      return { added: 0, version: this.state.version };
    }
    const rubs = added.filter((s) => s.erase).length;
    const summary = [added.length - rubs ? `drew ${plural(added.length - rubs, "stroke")}` : "", rubs ? `rubbed out with the duster${rubs > 1 ? ` (${rubs} times)` : ""}` : ""].filter(Boolean).join(" and ");
    this.changed({ change: "draw", by: "owner", region: null }, { who: { ...OWNER, device }, summary, add: { strokes: added } });
    return { added: fresh.length, version: this.state.version };
  }

  /** An item, from an agent (`by` its label) or the owner: placed where asked or in the next free space, replacing one of the writer's own if it says so. */
  write(input: BoardWriteInput, by: string, owner = false, device?: string): BoardItem {
    const replaced = input.replace ? this.state.items.find((i) => i.id === input.replace) : undefined;
    if (input.replace && !replaced) throw new BoardError(404, `there's no item ${input.replace} on the board`);
    if (replaced && !owner && replaced.by !== by) throw new BoardError(403, "an agent may change only what it wrote itself");
    if (!replaced && this.state.items.length >= L.items) throw new BoardError(409, `the board holds at most ${L.items} items: erase some first`);
    const layout = layoutItem(input.item, input.width);
    const w = Math.min(BOARD_W, layout.w);
    const h = Math.min(BOARD_H, layout.h);
    const others = { items: this.state.items.filter((i) => i !== replaced), strokes: this.state.strokes as BoardStroke[] };
    const spot =
      input.x !== undefined || input.y !== undefined
        ? { x: input.x ?? replaced?.x ?? 0, y: input.y ?? replaced?.y ?? 0 }
        : replaced
          ? { x: replaced.x, y: replaced.y }
          : freeSpot(others, w, h);
    const x = Math.max(0, Math.min(BOARD_W - w, Math.round(spot.x)));
    const y = Math.max(0, Math.min(BOARD_H - h, Math.round(spot.y)));
    const item = { ...input.item, id: replaced?.id ?? newId("i"), by, x, y, w, h, color: input.color ?? replaced?.color ?? "white", at: this.now() } as BoardItem;
    this.state.items = replaced ? this.state.items.map((i) => (i === replaced ? item : i)) : [...this.state.items, item];
    const what = item.kind === "equation" ? "an equation" : `a ${item.kind}`;
    this.changed(
      { change: "write", by: owner ? "owner" : "agent", region: { x, y, w, h } },
      { who: { by, owner, device }, summary: `${replaced ? "rewrote" : "wrote"} ${what}: ${JSON.stringify(itemSummary(item).slice(0, 120))}`, add: { items: [item] }, ...(replaced ? { remove: { items: [replaced.id] } } : {}) },
    );
    return item;
  }

  /**
   * Strokes and items gone. The owner may erase anything; an agent only items it
   * wrote itself, and never a stroke: nothing but the owner erases their drawing.
   */
  erase(ids: { strokes?: string[]; items?: string[] }, who: Who): { strokes: number; items: number } {
    if (ids.strokes?.length && !who.owner) throw new BoardError(403, "only the owner erases the owner's drawing");
    const items = new Set(ids.items ?? []);
    if (!who.owner) {
      const foreign = this.state.items.filter((i) => items.has(i.id) && i.by !== who.by);
      if (foreign.length) throw new BoardError(403, "an agent may erase only what it wrote itself");
    }
    const strokes = new Set(ids.strokes ?? []);
    const goneStrokes = this.state.strokes.filter((s) => strokes.has(s.id)).map((s) => s.id);
    const goneItems = this.state.items.filter((i) => items.has(i.id)).map((i) => i.id);
    if (!goneStrokes.length && !goneItems.length) return { strokes: 0, items: 0 };
    this.keepPicture();
    this.state.strokes = this.state.strokes.filter((s) => !strokes.has(s.id));
    this.state.items = this.state.items.filter((i) => !items.has(i.id));
    const summary = `erased ${[goneStrokes.length ? plural(goneStrokes.length, "stroke") : "", goneItems.length ? plural(goneItems.length, "item") : ""].filter(Boolean).join(" and ")}`;
    this.changed({ change: "erase", by: who.owner ? "owner" : "agent", region: null }, { who, summary, remove: { strokes: goneStrokes, items: goneItems } });
    return { strokes: goneStrokes.length, items: goneItems.length };
  }

  /** Everything off the board, the snapshot too (the owner's, from the route). Its history keeps all of it. */
  clear(device?: string): void {
    this.keepPicture();
    const remove = { items: this.state.items.map((i) => i.id), strokes: this.state.strokes.map((s) => s.id) };
    this.state.items = [];
    this.state.strokes = [];
    this.state.snapshot = null;
    rmSync(this.pngPath, { force: true });
    this.changed({ change: "clear", by: "owner", region: null }, { who: { ...OWNER, device }, summary: "cleared the board", remove });
  }

  /** A version from the history, back on the board in place of what's there (which the history keeps too). The owner's. */
  restore(version: number, device?: string): { version: number } {
    const found = this.history.state(version);
    if (!found) throw new BoardError(404, `the board's history has no version ${version}`);
    if (found.info.version === this.state.version) return { version: this.state.version };
    this.keepPicture();
    const next = { items: new Map(found.state.items.map((i) => [i.id, i])), strokes: new Set(found.state.strokes.map((s) => s.id)) };
    const now = { items: new Map(this.state.items.map((i) => [i.id, i])), strokes: new Set(this.state.strokes.map((s) => s.id)) };
    // An item that's there in another form (rewritten since) goes and comes back as it was.
    const changedItem = (id: string) => JSON.stringify(now.items.get(id)) !== JSON.stringify(next.items.get(id));
    const remove = { items: [...now.items.keys()].filter((id) => !next.items.has(id) || changedItem(id)), strokes: [...now.strokes].filter((id) => !next.strokes.has(id)) };
    const add = { items: found.state.items.filter((i) => !now.items.has(i.id) || changedItem(i.id)), strokes: found.state.strokes.filter((s) => !now.strokes.has(s.id)) };
    this.state.items = found.state.items;
    this.state.strokes = found.state.strokes;
    this.state.snapshot = null;
    rmSync(this.pngPath, { force: true });
    this.changed({ change: "restore", by: "owner", region: null }, { who: { ...OWNER, device }, summary: `restored version ${found.info.version}`, add, remove });
    return { version: this.state.version };
  }

  /** The history forgotten, all of it (the owner's choice, from the route); it starts again from the board as it is. */
  forgetHistory(device?: string): void {
    this.history.forget({ version: this.state.version, at: this.now(), by: "owner", device, change: "start", summary: "forgot the board's history before this" }, this.state as BoardHistoryState);
    this.pictureKept = !this.state.snapshot;
  }

  /** The PNG of what the owner last saw, with what it shows. */
  snapshot(): { png: Uint8Array<ArrayBuffer>; info: BoardSnapshotInfo } | null {
    const info = this.state.snapshot;
    if (!info) return null;
    try {
      return { png: new Uint8Array(readFileSync(this.pngPath)), info };
    } catch {
      return null;
    }
  }
}

/** Something to wait on, synchronously, between tries of a rename. */
const PAUSE = new Int32Array(new SharedArrayBuffer(4));

/** A temporary file beside the target, then a rename over it: a reader sees the old file or the new one, never half of one. */
export function atomicWrite(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(tmp, data, { mode: 0o600 });
    // On Windows a rename over a file something has open for a moment (a virus scanner, the indexer,
    // just after the last write) fails with EPERM, EACCES or EBUSY: wait a little and try again.
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(tmp, path);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 12 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
        Atomics.wait(PAUSE, 0, 0, attempt * 5);
      }
    }
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/* ---------------- the snapshot: a PNG, checked byte by byte ---------------- */

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * The owner's snapshot, refused unless it's exactly a PNG we'd draw: within the
 * byte budget; IHDR first, 8-bit RGB or RGBA, not interlaced, 16:9 within the
 * pixel limits; every chunk's CRC right; its image data inflating (bounded) to
 * exactly its rows, each with a valid filter. It's kept rebuilt from IHDR, the
 * image data and IEND alone, so nothing else in the file (text, profiles,
 * anything appended) reaches a model.
 */
export function checkPng(bytes: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  const fail = (why: string): never => {
    throw new BoardError(400, `the snapshot isn't a PNG the board takes: ${why}`);
  };
  if (bytes.length > L.snapshotBytes) fail(`it's over ${L.snapshotBytes / 1024} KB`);
  if (bytes.length < SIGNATURE.length + 12 * 3 || !SIGNATURE.every((b, i) => bytes[i] === b)) fail("no PNG signature");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = SIGNATURE.length;
  let header: Uint8Array | null = null;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  let ended = false;
  while (at < bytes.length) {
    if (at + 12 > bytes.length) fail("a chunk is cut off");
    const length = view.getUint32(at);
    if (length > bytes.length - at - 12) fail("a chunk runs past the end");
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) fail("a chunk has no name");
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (view.getUint32(at + 8 + length) !== crc32(bytes.subarray(at + 4, at + 8 + length))) fail(`${type}'s checksum is wrong`);
    at += 12 + length;
    if (!header && type !== "IHDR") fail("IHDR isn't first");
    if (type === "IHDR") {
      if (header || length !== 13) fail("a second or malformed IHDR");
      header = data;
      const d = new DataView(data.buffer, data.byteOffset, 13);
      width = d.getUint32(0);
      height = d.getUint32(4);
      const [depth, color, compression, filter, interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || (color !== 2 && color !== 6) || compression !== 0 || filter !== 0 || interlace !== 0) fail("only 8-bit RGB or RGBA, not interlaced");
      channels = color === 6 ? 4 : 3;
      if (width < L.snapshotMinW || width > L.snapshotMaxW) fail(`${width} pixels across (${L.snapshotMinW}–${L.snapshotMaxW})`);
      if (Math.abs(width / height - BOARD_W / BOARD_H) > 0.02) fail(`${width} × ${height} isn't the board's 16:9`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") {
      ended = true;
      break;
    } else if (type[0]! === type[0]!.toUpperCase()) fail(`a critical chunk it doesn't take (${type})`);
    // Ancillary chunks (gAMA, sRGB, pHYs, iCCP, text) are skipped: they don't reach the kept file.
  }
  if (!header || !ended || !idat.length) fail("no image data, or no end");
  const compressed = Buffer.concat(idat);
  const expected = height * (1 + width * channels);
  let raw: Buffer;
  try {
    raw = inflateSync(compressed, { maxOutputLength: expected + 1 });
  } catch {
    return fail("its image data doesn't inflate to its size");
  }
  if (raw.length !== expected) fail("its image data isn't the size its header says");
  for (let row = 0; row < height; row++) if (raw[row * (1 + width * channels)]! > 4) fail("a row has an unknown filter");
  const kept = Buffer.concat([SIGNATURE, chunk("IHDR", header!), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())]);
  return { bytes: new Uint8Array(kept), width, height };
}
