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

/*
 * The chalkboard, as the node keeps it: one JSON file per board in the home
 * (`boards/<id>.json`) and the PNG of what the owner last saw beside it
 * (`boards/<id>.png`), each written atomically (a temporary file, then a
 * rename), mode 600. Node-local: it never replicates (the mind is the record
 * of what's decided; the board is a working surface). A file that can't be
 * read or doesn't pass the contract is set aside, never trusted, and the board
 * starts clean. Every count and size is capped (BOARD_LIMITS in core).
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
  /** Told after every change (the world's stream says it). */
  onChange?: (change: BoardChange) => void;
}

const newId = (prefix: "s" | "i") => `${prefix}_${randomBytes(9).toString("base64url")}`;
/** Points are kept to a tenth of a board unit: plenty for chalk, and the file stays small. */
const tenth = (v: number) => Math.round(v * 10) / 10;

export class BoardStore {
  readonly path: string;
  readonly pngPath: string;
  private state: z.infer<typeof BoardFile>;
  private readonly now: () => number;

  constructor(private readonly opts: BoardStoreOptions) {
    const id = opts.id ?? "main";
    if (!/^[a-z0-9-]{1,32}$/.test(id)) throw new Error("a board's id is lowercase letters, digits and -");
    this.path = join(opts.dir, `${id}.json`);
    this.pngPath = join(opts.dir, `${id}.png`);
    this.now = opts.now ?? Date.now;
    this.state = this.load();
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
      this.opts.log?.(`board: ${this.path} couldn't be read (${(error as Error).message.slice(0, 200)}); set aside as ${aside}, starting a clean board`);
      // A version past anything a page could have seen, so every page fetches the clean board.
      return { ...empty, version: 1 };
    }
  }

  private save(): void {
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    atomicWrite(this.path, `${JSON.stringify(this.state)}\n`);
  }

  private changed(change: Omit<BoardChange, "version">): void {
    this.state.version++;
    this.state.updatedAt = this.now();
    this.save();
    this.opts.onChange?.({ version: this.state.version, ...change });
  }

  get version(): number {
    return this.state.version;
  }

  view(): BoardView {
    const { v: _v, ...view } = this.state;
    return view as BoardView;
  }

  /** The owner's strokes (a stroke already there, by its id, is skipped: a retry adds nothing twice), and the PNG of what they see. */
  draw(strokes: StrokeInput[], snapshot?: Uint8Array): { added: number; version: number } {
    const have = new Set(this.state.strokes.map((s) => s.id));
    const fresh = strokes.filter((s, i) => !have.has(s.id) && strokes.findIndex((t) => t.id === s.id) === i);
    const points = this.state.strokes.reduce((n, s) => n + s.points.length / 2, 0) + fresh.reduce((n, s) => n + s.points.length / 2, 0);
    if (this.state.strokes.length + fresh.length > L.strokes || points > L.boardPoints) {
      throw new BoardError(409, "the board is full: erase some of the drawing, or clear the board");
    }
    const png = snapshot ? checkPng(snapshot) : null;
    const at = this.now();
    for (const s of fresh) {
      this.state.strokes.push({
        id: s.id,
        color: s.color,
        width: tenth(s.width),
        points: s.points.map(tenth),
        ...(s.pressure ? { pressure: s.pressure.map((p) => Math.round(p * 100) / 100) } : {}),
        ...(s.erase ? { erase: true } : {}),
        at,
      });
    }
    if (png) {
      mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
      atomicWrite(this.pngPath, png.bytes);
      // The snapshot shows the board as it is after these strokes.
      this.state.snapshot = { at, version: this.state.version + (fresh.length ? 1 : 0), width: png.width, height: png.height, bytes: png.bytes.length };
    }
    if (!fresh.length) {
      // A snapshot alone changes nothing anyone sees: kept, but no new version.
      if (png) this.save();
      return { added: 0, version: this.state.version };
    }
    this.changed({ change: "draw", by: "owner", region: null });
    return { added: fresh.length, version: this.state.version };
  }

  /** An item, from an agent (`by` its label) or the owner: placed where asked or in the next free space, replacing one of the writer's own if it says so. */
  write(input: BoardWriteInput, by: string, owner = false): BoardItem {
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
    this.changed({ change: "write", by: owner ? "owner" : "agent", region: { x, y, w, h } });
    return item;
  }

  /**
   * Strokes and items gone. The owner may erase anything; an agent only items it
   * wrote itself, and never a stroke: nothing but the owner erases their drawing.
   */
  erase(ids: { strokes?: string[]; items?: string[] }, who: { owner: boolean; by: string }): { strokes: number; items: number } {
    if (ids.strokes?.length && !who.owner) throw new BoardError(403, "only the owner erases the owner's drawing");
    const items = new Set(ids.items ?? []);
    if (!who.owner) {
      const foreign = this.state.items.filter((i) => items.has(i.id) && i.by !== who.by);
      if (foreign.length) throw new BoardError(403, "an agent may erase only what it wrote itself");
    }
    const strokes = new Set(ids.strokes ?? []);
    const before = { strokes: this.state.strokes.length, items: this.state.items.length };
    this.state.strokes = this.state.strokes.filter((s) => !strokes.has(s.id));
    this.state.items = this.state.items.filter((i) => !items.has(i.id));
    const gone = { strokes: before.strokes - this.state.strokes.length, items: before.items - this.state.items.length };
    if (gone.strokes || gone.items) this.changed({ change: "erase", by: who.owner ? "owner" : "agent", region: null });
    return gone;
  }

  /** Everything off the board, the snapshot too (the owner's, from the route). */
  clear(): void {
    this.state.items = [];
    this.state.strokes = [];
    this.state.snapshot = null;
    rmSync(this.pngPath, { force: true });
    this.changed({ change: "clear", by: "owner", region: null });
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
function atomicWrite(path: string, data: string | Uint8Array): void {
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

/* ---------------- for the node itself ---------------- */

/** What a world shows of a write: just enough to say where he's going and what for. */
interface Shown {
  doing(station: "observatory", doing: string): void;
}

/**
 * Galahad writes on the board from the node itself (an experiment's
 * examination, say): the same checks as the route, the item his ("galahad", or
 * the agent named), and the world shows him at the board writing it.
 *
 *   writeOnBoard({ board: ctx.board, world: ctx.world }, { item: { kind: "note", title: "Examination", text: "…" } });
 */
export function writeOnBoard(deps: { board: BoardStore; world?: Shown }, input: z.input<typeof BoardWriteInput>, by = "galahad"): BoardItem {
  const item = deps.board.write(BoardWriteInput.parse(input), by);
  deps.world?.doing("observatory", `Writing on the chalkboard: ${itemSummary(item).slice(0, 80)}`);
  return item;
}
