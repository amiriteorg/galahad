import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { type BoardHistoryChange, type BoardItem, type BoardStroke, type BoardVersionInfo, type BoardVersionView, BOARD_W, BOARD_H, describeDrawing, ItemStored, StrokeStored } from "@galahad/core";
import { z } from "zod";
import { boardLines } from "./board-cli.ts";

/*
 * The chalkboard's history: every version it has had, kept, so clearing or
 * erasing never destroys what was there. Append-only, beside the board in the
 * node's home (`boards/<id>.history/`):
 *
 *   000001.jsonl.gz, 000002.jsonl.gz …   sealed segments (gzipped, never changed again)
 *   000003.jsonl                         the segment being written: one record a line
 *   pictures/<version>.png               the owner's picture of the board, now and then
 *
 * A record is one change: who made it, when, and what it added and took away
 * (a small diff; strokes are kept once, when they're drawn). Every segment
 * starts with the whole board (a checkpoint), and so does every hundredth
 * record, so any version is a short replay. A segment is sealed at 2 MB. The
 * owner's picture is kept at most every two minutes while they draw, and always
 * before anything is erased, cleared or restored over. A line that can't be read
 * (a crash mid-write) is skipped. Only the owner forgets history (the route).
 */

const SEGMENT_MAX = 2 * 1024 * 1024;
const CHECKPOINT_EVERY = 100;
/** The owner's picture is kept at most this often while they draw. */
export const PICTURE_EVERY_MS = 2 * 60_000;

const Diff = z.strictObject({ items: z.array(ItemStored).optional(), strokes: z.array(StrokeStored).optional() });
const Record = z.strictObject({
  v: z.literal(1),
  version: z.number().int().min(0),
  at: z.number(),
  by: z.string().min(1).max(64),
  device: z.string().max(100).optional(),
  change: z.enum(["start", "draw", "write", "erase", "clear", "restore"]),
  summary: z.string().max(300),
  add: Diff.optional(),
  remove: z.strictObject({ items: z.array(z.string().max(40)).optional(), strokes: z.array(z.string().max(40)).optional() }).optional(),
  /** The whole board after this change: a checkpoint. */
  state: z.strictObject({ items: z.array(ItemStored), strokes: z.array(StrokeStored) }).optional(),
});
type HistoryRecord = z.infer<typeof Record>;

export interface BoardState {
  items: BoardItem[];
  strokes: BoardStroke[];
}

export interface Change {
  version: number;
  at: number;
  by: string;
  device?: string | undefined;
  change: BoardHistoryChange;
  summary: string;
  add?: { items?: BoardItem[]; strokes?: BoardStroke[] };
  remove?: { items?: string[]; strokes?: string[] };
}

interface Entry {
  version: number;
  at: number;
  by: string;
  device: string | null;
  change: BoardHistoryChange;
  summary: string;
  segment: string;
  line: number;
  checkpoint: boolean;
}

const segmentName = (n: number) => String(n).padStart(6, "0");

export class BoardHistory {
  private entries: Entry[] = [];
  /** Kept pictures, by the version each shows. */
  private pictures: number[] = [];
  private segment = 1;
  private sinceCheckpoint = 0;
  private lastPictureAt = 0;
  private readonly cache = new Map<string, (HistoryRecord | null)[]>();
  readonly picturesDir: string;

  constructor(
    readonly dir: string,
    private readonly opts: { now?: () => number; log?: (message: string) => void } = {},
  ) {
    this.picturesDir = join(dir, "pictures");
    this.load();
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private load(): void {
    this.entries = [];
    this.cache.clear();
    if (!existsSync(this.dir)) return;
    const names = readdirSync(this.dir)
      .filter((f) => /^\d{6}\.jsonl(\.gz)?$/.test(f))
      .sort();
    let skipped = 0;
    for (const file of names) {
      const name = file.slice(0, 6);
      const records = this.read(name);
      records.forEach((r, line) => {
        if (!r || (this.entries.length && r.version <= this.entries.at(-1)!.version)) {
          if (!r) skipped++;
          return;
        }
        this.entries.push({ version: r.version, at: r.at, by: r.by, device: r.device ?? null, change: r.change, summary: r.summary, segment: name, line, checkpoint: !!r.state });
      });
      this.segment = Math.max(this.segment, Number(name));
    }
    if (skipped) this.opts.log?.(`board history: ${skipped} line(s) couldn't be read (a write cut short); skipped`);
    // Records since the last checkpoint, in the segment being written.
    const tail = this.entries.filter((e) => e.segment === segmentName(this.segment));
    const lastCheckpoint = tail.findLastIndex((e) => e.checkpoint);
    this.sinceCheckpoint = lastCheckpoint < 0 ? CHECKPOINT_EVERY : tail.length - 1 - lastCheckpoint;
    // A segment that ends mid-line (a crash): the next record starts on a line of its own.
    const active = join(this.dir, `${segmentName(this.segment)}.jsonl`);
    if (existsSync(active)) {
      const text = readFileSync(active, "utf8");
      if (text && !text.endsWith("\n")) appendFileSync(active, "\n");
    }
    if (existsSync(this.picturesDir)) {
      this.pictures = readdirSync(this.picturesDir)
        .map((f) => f.match(/^(\d+)\.png$/)?.[1])
        .filter((v): v is string => !!v)
        .map(Number)
        .sort((a, b) => a - b);
      const newest = this.pictures.at(-1);
      if (newest !== undefined) this.lastPictureAt = statSync(join(this.picturesDir, `${newest}.png`)).mtimeMs;
    }
  }

  /** A segment's records (null for a line that can't be read). */
  private read(name: string): (HistoryRecord | null)[] {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const plain = join(this.dir, `${name}.jsonl`);
    const sealed = `${plain}.gz`;
    let text = "";
    try {
      text = existsSync(sealed) ? gunzipSync(readFileSync(sealed)).toString("utf8") : existsSync(plain) ? readFileSync(plain, "utf8") : "";
    } catch {
      this.opts.log?.(`board history: segment ${name} couldn't be read`);
    }
    const records = text
      .split("\n")
      .filter((l) => l.trim())
      .map((line) => {
        try {
          return Record.parse(JSON.parse(line));
        } catch {
          return null;
        }
      });
    this.cache.set(name, records);
    // Two segments in memory at most: the one being written, and one being read.
    if (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value!);
    return records;
  }

  get latest(): number | null {
    return this.entries.at(-1)?.version ?? null;
  }

  get size(): number {
    return this.entries.length;
  }

  /** One change, appended, before the board's own file is written: the history is never behind the board. */
  append(change: Change, after: BoardState): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    let active = join(this.dir, `${segmentName(this.segment)}.jsonl`);
    // A full segment is sealed (gzipped, never written again); the next starts with the whole board.
    if (existsSync(active) && statSync(active).size >= SEGMENT_MAX) {
      writeFileSync(`${active}.gz.tmp`, gzipSync(readFileSync(active)), { mode: 0o600 });
      renameSync(`${active}.gz.tmp`, `${active}.gz`);
      rmSync(active, { force: true });
      this.cache.delete(segmentName(this.segment));
      this.segment++;
      this.sinceCheckpoint = CHECKPOINT_EVERY;
      active = join(this.dir, `${segmentName(this.segment)}.jsonl`);
    }
    const checkpoint = this.sinceCheckpoint >= CHECKPOINT_EVERY || change.change === "start";
    const record: HistoryRecord = {
      v: 1,
      version: change.version,
      at: change.at,
      by: change.by,
      ...(change.device ? { device: change.device.slice(0, 100) } : {}),
      change: change.change,
      summary: change.summary.slice(0, 300),
      ...(change.add && (change.add.items?.length || change.add.strokes?.length) ? { add: change.add } : {}),
      ...(change.remove && (change.remove.items?.length || change.remove.strokes?.length) ? { remove: change.remove } : {}),
      ...(checkpoint ? { state: { items: after.items, strokes: after.strokes } } : {}),
    } as HistoryRecord;
    appendFileSync(active, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    const name = segmentName(this.segment);
    const cached = this.cache.get(name);
    if (cached) cached.push(record);
    this.entries.push({ version: record.version, at: record.at, by: record.by, device: record.device ?? null, change: record.change, summary: record.summary, segment: name, line: (cached?.length ?? this.read(name).length) - 1, checkpoint });
    this.sinceCheckpoint = checkpoint ? 0 : this.sinceCheckpoint + 1;
  }

  /**
   * Keeps the owner's picture of the board (the version it shows): at most every
   * two minutes while they draw, or now when `force` (before something is wiped).
   */
  keepPicture(png: Uint8Array, version: number, force = false): boolean {
    const now = this.now();
    if (!force && now - this.lastPictureAt < PICTURE_EVERY_MS) return false;
    mkdirSync(this.picturesDir, { recursive: true, mode: 0o700 });
    const path = join(this.picturesDir, `${version}.png`);
    writeFileSync(`${path}.tmp`, png, { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    if (!this.pictures.includes(version)) this.pictures = [...this.pictures, version].sort((a, b) => a - b);
    this.lastPictureAt = now;
    return true;
  }

  private entryAt(version: number): Entry | null {
    let found: Entry | null = null;
    for (const e of this.entries) {
      if (e.version > version) break;
      found = e;
    }
    return found;
  }

  /** The nearest kept picture at or before a version, if nothing wiped the board in between. */
  pictureFor(version: number): number | null {
    const at = this.pictures.filter((p) => p <= version).at(-1);
    if (at === undefined) return null;
    const wiped = this.entries.some((e) => e.version > at && e.version <= version && (e.change === "clear" || e.change === "restore"));
    return wiped ? null : at;
  }

  picture(version: number): { png: Uint8Array; shows: number } | null {
    const shows = this.pictureFor(version);
    if (shows === null) return null;
    try {
      return { png: new Uint8Array(readFileSync(join(this.picturesDir, `${shows}.png`))), shows };
    } catch {
      return null;
    }
  }

  private info(e: Entry): BoardVersionInfo {
    return { version: e.version, at: e.at, by: e.by, device: e.device, change: e.change, summary: e.summary, picture: this.pictureFor(e.version) };
  }

  /** Versions after `after` (oldest first), at most `limit`. */
  since(after: number | null, limit: number): BoardVersionInfo[] {
    return this.entries.filter((e) => after === null || e.version > after).slice(0, limit).map((e) => this.info(e));
  }

  /** Versions before `before` (newest first), at most `limit`; and whether there are older ones. */
  before(before: number | null, limit: number): { versions: BoardVersionInfo[]; more: boolean } {
    const older = this.entries.filter((e) => before === null || e.version < before);
    return { versions: older.slice(-limit).reverse().map((e) => this.info(e)), more: older.length > limit };
  }

  /** The board as it stood at a version (the last change at or before it): a checkpoint, then the changes since. */
  state(version: number): { info: BoardVersionInfo; state: BoardState } | null {
    // Past the newest version there's nothing yet.
    if (this.latest === null || version > this.latest) return null;
    const target = this.entryAt(version);
    if (!target) return null;
    const i = this.entries.indexOf(target);
    let c = i;
    while (c >= 0 && !this.entries[c]!.checkpoint) c--;
    if (c < 0) return null;
    const records = (e: Entry) => this.read(e.segment)[e.line] ?? null;
    const base = records(this.entries[c]!);
    if (!base?.state) return null;
    const items = new Map(base.state.items.map((x) => [x.id, x as BoardItem]));
    const strokes = new Map(base.state.strokes.map((x) => [x.id, x as BoardStroke]));
    for (let k = c + 1; k <= i; k++) {
      const r = records(this.entries[k]!);
      if (!r) continue;
      if (r.state) {
        items.clear();
        strokes.clear();
        for (const x of r.state.items) items.set(x.id, x as BoardItem);
        for (const x of r.state.strokes) strokes.set(x.id, x as BoardStroke);
        continue;
      }
      for (const id of r.remove?.items ?? []) items.delete(id);
      for (const id of r.remove?.strokes ?? []) strokes.delete(id);
      for (const x of r.add?.items ?? []) items.set(x.id, x as BoardItem);
      for (const x of r.add?.strokes ?? []) strokes.set(x.id, x as BoardStroke);
    }
    return { info: this.info(target), state: { items: [...items.values()], strokes: [...strokes.values()] } };
  }

  /** Everything forgotten (the owner's choice), and a fresh start: the board as it stands now. */
  forget(now: Change, state: BoardState): void {
    rmSync(this.dir, { recursive: true, force: true });
    this.entries = [];
    this.pictures = [];
    this.cache.clear();
    this.segment = 1;
    this.sinceCheckpoint = CHECKPOINT_EVERY;
    this.lastPictureAt = 0;
    this.append(now, state);
  }
}

/* ---------------- for an archive: the board's versions, without knowing how they're kept ---------------- */

/** What a board store gives an archive. */
interface Archivable {
  readonly history: BoardHistory;
}

const CURSOR = /^board:main:(\d+)$/;
/** The archive's cursor after a version. */
export const boardCursor = (version: number): string => `board:main:${version}`;

/**
 * Board versions after `cursor` (null: from the first), oldest first, in a stable
 * order (by version; versions only grow, and are never reused, even after the
 * owner forgets history), at most `limit`. Pass the returned cursor next time;
 * it's null when there's nothing new.
 *
 *   let cursor = saved;
 *   for (;;) { const { versions, cursor: next } = boardVersionsSince(daemon.board, cursor); if (!next) break; … cursor = next; }
 */
export function boardVersionsSince(board: Archivable, cursor: string | null, limit = 100): { versions: BoardVersionInfo[]; cursor: string | null } {
  const after = cursor === null ? null : Number(cursor.match(CURSOR)?.[1] ?? Number.NaN);
  if (after !== null && !Number.isFinite(after)) throw new Error(`not a board cursor: ${cursor}`);
  const versions = board.history.since(after, Math.max(1, Math.min(1000, limit)));
  return { versions, cursor: versions.length ? boardCursor(versions.at(-1)!.version) : null };
}

/**
 * One version, for an archive and its index: the board as it stood (its items
 * and strokes), the whole of it as plain text (each item in full, who wrote it
 * and where, then the owner's drawing described), and its picture (the nearest
 * kept at or before it, with the version it shows), or null if there's none.
 */
export function boardVersionForArchive(board: Archivable, version: number): (BoardVersionView & { image: { png: Uint8Array; shows: number } | null }) | null {
  const found = board.history.state(version);
  if (!found) return null;
  return { info: found.info, items: found.state.items, strokes: found.state.strokes, text: versionText(found.info, found.state), image: board.history.picture(found.info.version) };
}

/** A version in words: when, who and what changed; every item in full; the drawing described. */
export function versionText(info: BoardVersionInfo, state: BoardState): string {
  const who = info.by === "owner" ? `the owner${info.device ? ` (${info.device})` : ""}` : info.by === "galahad" ? "Galahad" : `the agent ${info.by}`;
  const { items, drawing } = boardLines({ version: info.version, updatedAt: info.at, items: state.items, strokes: state.strokes, snapshot: null });
  return [
    `Chalkboard, version ${info.version} (${BOARD_W} × ${BOARD_H}), ${new Date(info.at).toISOString()}: ${who} ${info.summary}.`,
    items.length ? `\nWritten on it (${items.length}):` : "\nNothing written on it.",
    ...items.map((i) => `\n- ${i.title}\n${i.lines.map((l) => `    ${l}`).join("\n")}`),
    `\n${drawing === describeDrawing({ items: [], strokes: [] }) ? "Nothing drawn on it." : drawing}`,
  ].join("\n");
}
