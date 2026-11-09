import { Database } from "bun:sqlite";
import {
  type BodyOf,
  bodyOf,
  canonical,
  compareEvents,
  type DeviceId,
  type EventKind,
  type GEvent,
  HlcClock,
  isKnownKind,
  isNodeId,
  type Json,
  parseEvent,
  type Prov,
  type Scope,
  sha256B64u,
  signEvent,
  type NodeIdentity,
} from "@galahad/core";

/*
 * The Mind's local replica.
 *
 *  events      the signed, append-only log (the only source of truth)
 *  v_*         views materialized from the log (always rebuildable)
 *
 * Materialized state is a pure function of the *set* of events: events are
 * applied in (hlc, id) order, and if an event arrives out of order we replay
 * the log. So any two replicas holding the same events hold identical state,
 * regardless of delivery order or duplication.
 */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, hlc TEXT NOT NULL, device TEXT NOT NULL, kind TEXT NOT NULL, raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_order ON events (hlc, id);
CREATE INDEX IF NOT EXISTS events_device ON events (device, hlc);
`;

const VIEWS = `
CREATE TABLE IF NOT EXISTS v_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v_devices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, role TEXT NOT NULL, box TEXT,
  scopes TEXT NOT NULL, enrolled_by TEXT NOT NULL, enrolled_hlc TEXT NOT NULL, revoked_hlc TEXT,
  profile TEXT, profile_hlc TEXT
);
CREATE TABLE IF NOT EXISTS v_memories (
  id TEXT PRIMARY KEY, text TEXT NOT NULL, tags TEXT NOT NULL, device TEXT NOT NULL, via TEXT,
  trust TEXT NOT NULL, hlc TEXT NOT NULL, forgotten INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS v_memories_fts USING fts5 (id UNINDEXED, text, tags);
CREATE TABLE IF NOT EXISTS v_lww (k TEXT PRIMARY KEY, hlc TEXT NOT NULL, eid TEXT NOT NULL, device TEXT NOT NULL, v TEXT);
CREATE TABLE IF NOT EXISTS v_grants (kid TEXT NOT NULL, device TEXT NOT NULL, box TEXT NOT NULL, PRIMARY KEY (kid, device));
CREATE TABLE IF NOT EXISTS v_rejected (id TEXT PRIMARY KEY, reason TEXT NOT NULL);
`;

const VIEW_TABLES = ["v_state", "v_devices", "v_memories", "v_memories_fts", "v_lww", "v_grants", "v_rejected"];

export interface Device {
  id: DeviceId;
  name: string;
  kind: "node" | "client";
  role: "full" | "limited" | "client";
  box: string | null;
  scopes: Scope[];
  enrolledBy: DeviceId;
  enrolledHlc: string;
  revokedHlc: string | null;
  profile: { endpoint?: string; caps: Record<string, unknown> } | null;
}

export interface Memory {
  id: string;
  text: string;
  tags: string[];
  device: DeviceId;
  via: string | null;
  trust: string;
  hlc: string;
}

export interface IngestResult {
  added: number;
  invalid: { id?: string; error: string }[];
  rebuilt: boolean;
}

export interface LwwEntry<T = Json> {
  key: string;
  hlc: string;
  eid: string;
  device: DeviceId;
  value: T | null;
}

export class MindStore {
  readonly db: Database;
  readonly clock: HlcClock;
  private readonly listeners = new Set<(event: GEvent) => void>();

  /** Called after each event this node writes (e.g. to push it to peers). */
  onEmit(listener: (event: GEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  constructor(path: string, clock = new HlcClock()) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(SCHEMA);
    this.db.exec(VIEWS);
    this.clock = clock;
    const latest = this.db.query<{ hlc: string }, []>("SELECT hlc FROM events ORDER BY hlc DESC, id DESC LIMIT 1").get();
    if (latest) this.safeObserve(latest.hlc);
  }

  close(): void {
    this.db.close();
  }

  // ---- fleet identity ------------------------------------------------------

  /** The fleet this replica belongs to (= genesis event id). Set once. */
  get fleet(): string | null {
    return this.meta("fleet");
  }

  expectFleet(fleet: string): void {
    const current = this.fleet;
    if (current && current !== fleet) throw new Error(`replica already belongs to fleet ${current}`);
    this.setMeta("fleet", fleet);
  }

  meta(key: string): string | null {
    return this.db.query<{ v: string }, [string]>("SELECT v FROM meta WHERE k = ?").get(key)?.v ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.query("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(key, value);
  }

  // ---- writing -------------------------------------------------------------

  /** Create, sign and apply a new event authored by this node. */
  emit<K extends EventKind>(signer: NodeIdentity, kind: K, body: BodyOf<K>, prov?: Prov): GEvent {
    const fleet = kind === "fleet.genesis" ? "" : this.fleet;
    if (fleet === null) throw new Error("replica has no fleet yet");
    const event = signEvent(
      { v: 1, fleet, hlc: this.clock.tick(), device: signer.id, kind, body: body as Json, ...(prov ? { prov } : {}) },
      signer,
    );
    // Atomic: an event this node is not authorized to write never enters the log.
    this.db.transaction(() => {
      if (kind === "fleet.genesis") this.expectFleet(event.id);
      const result = this.ingest([event]);
      if (result.invalid.length) throw new Error(`emit rejected: ${result.invalid[0]!.error}`);
      const rejected = this.rejection(event.id);
      if (rejected) throw new Error(`emit not authorized: ${rejected}`);
    })();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* listeners must not break writes */
      }
    }
    return event;
  }

  // ---- ingesting -----------------------------------------------------------

  /**
   * Verify and store events from anywhere (sync, push, local emit). Idempotent:
   * duplicates are ignored, out-of-order arrivals trigger a deterministic replay.
   */
  ingest(raws: unknown[]): IngestResult {
    const fleet = this.fleet;
    const invalid: IngestResult["invalid"] = [];
    const fresh: GEvent[] = [];
    for (const raw of raws) {
      let event: GEvent;
      try {
        event = parseEvent(raw);
      } catch (error) {
        invalid.push({ id: (raw as { id?: string })?.id, error: String((error as Error).message ?? error) });
        continue;
      }
      const isGenesis = event.kind === "fleet.genesis";
      if (!fleet) {
        invalid.push({ id: event.id, error: "replica has no fleet; set expectFleet first" });
        continue;
      }
      if (isGenesis ? event.id !== fleet || event.fleet !== "" : event.fleet !== fleet) {
        invalid.push({ id: event.id, error: "event belongs to another fleet" });
        continue;
      }
      if (!this.clock.acceptable(event.hlc)) {
        invalid.push({ id: event.id, error: "timestamp too far in the future" });
        continue;
      }
      fresh.push(event);
    }
    if (!fresh.length) return { added: 0, invalid, rebuilt: false };

    let added = 0;
    let rebuilt = false;
    this.db.transaction(() => {
      const insert = this.db.query("INSERT OR IGNORE INTO events (id, hlc, device, kind, raw) VALUES (?, ?, ?, ?, ?)");
      const inserted: GEvent[] = [];
      for (const event of fresh) {
        if (insert.run(event.id, event.hlc, event.device, event.kind, JSON.stringify(event)).changes) inserted.push(event);
      }
      added = inserted.length;
      if (!added) return;
      inserted.sort(compareEvents);
      const tail = this.appliedTail();
      if (tail && compareEvents(inserted[0]!, tail) <= 0) {
        this.replay();
        rebuilt = true;
      } else {
        for (const event of inserted) this.apply(event);
      }
    })();
    for (const event of fresh) this.safeObserve(event.hlc);
    return { added, invalid, rebuilt };
  }

  /** Drop every view and re-materialize from the log. Same events ⇒ same state. */
  rebuild(): void {
    this.db.transaction(() => this.replay())();
  }

  private replay(): void {
    for (const table of VIEW_TABLES) this.db.exec(`DELETE FROM ${table}`);
    const rows = this.db.query<{ raw: string }, []>("SELECT raw FROM events ORDER BY hlc, id").all();
    for (const row of rows) this.apply(JSON.parse(row.raw) as GEvent);
  }

  private appliedTail(): { hlc: string; id: string } | null {
    const raw = this.db.query<{ v: string }, []>("SELECT v FROM v_state WHERE k = 'tail'").get()?.v;
    return raw ? (JSON.parse(raw) as { hlc: string; id: string }) : null;
  }

  private setState(key: string, value: Json): void {
    this.db
      .query("INSERT INTO v_state (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v")
      .run(key, JSON.stringify(value));
  }

  private state<T>(key: string): T | null {
    const raw = this.db.query<{ v: string }, [string]>("SELECT v FROM v_state WHERE k = ?").get(key)?.v;
    return raw ? (JSON.parse(raw) as T) : null;
  }

  private safeObserve(hlc: string): void {
    try {
      this.clock.observe(hlc);
    } catch {
      /* far-future timestamps were already rejected at ingest */
    }
  }

  // ---- materialization (pure, deterministic) -------------------------------

  private apply(event: GEvent): void {
    this.setState("tail", { hlc: event.hlc, id: event.id });
    const reason = this.applyKind(event);
    if (reason) this.db.query("INSERT OR REPLACE INTO v_rejected (id, reason) VALUES (?, ?)").run(event.id, reason);
  }

  /** Returns a rejection reason, or null when applied. */
  private applyKind(event: GEvent): string | null {
    if (!isKnownKind(event.kind)) return null; // stored for forward compatibility; newer nodes understand it
    const signer = this.deviceAt(event.device, event.hlc);
    const genesis = this.state<{ id: string; device: string; name: string }>("genesis");

    if (event.kind === "fleet.genesis") {
      if (genesis) return "fleet already has a genesis";
      const body = bodyOf(event, "fleet.genesis");
      this.setState("genesis", { id: event.id, device: event.device, name: body.name });
      return null;
    }
    if (!genesis) return "no genesis yet";

    if (event.kind === "device.enrolled") {
      const body = bodyOf(event, "device.enrolled");
      const bootstrap = event.device === genesis.device && body.device === event.device && !this.anyDevices();
      if (!bootstrap && !isFullNode(signer)) return "only an active full node may enroll devices";
      if (this.device(body.device)) return "device already enrolled";
      if (body.kind === "node" && (!isNodeId(body.device) || !body.box)) return "nodes need an ed25519 id and a box key";
      if (body.kind === "client" && body.role !== "client") return "clients must have the client role";
      this.db
        .query(
          `INSERT INTO v_devices (id, name, kind, role, box, scopes, enrolled_by, enrolled_hlc)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(body.device, body.name, body.kind, body.role, body.box ?? null, JSON.stringify(body.scopes), event.device, event.hlc);
      return null;
    }

    // Everything below requires an enrolled, not-revoked signer.
    if (!signer) return "signer is not an active device";

    switch (event.kind) {
      case "device.revoked": {
        if (!isFullNode(signer)) return "only full nodes may revoke";
        const body = bodyOf(event, "device.revoked");
        const target = this.device(body.device);
        if (!target || target.revokedHlc) return "unknown or already revoked device";
        const remainingFull = this.devices().filter((d) => isFullNode(d) && d.id !== target.id).length;
        if (isFullNode(target) && remainingFull === 0) return "refusing to revoke the last full node";
        this.db.query("UPDATE v_devices SET revoked_hlc = ? WHERE id = ?").run(event.hlc, body.device);
        return null;
      }
      case "node.profile": {
        const body = bodyOf(event, "node.profile");
        const previous = this.profileHlc(event.device);
        if (previous && previous >= event.hlc) return null;
        this.db
          .query("UPDATE v_devices SET profile = ?, profile_hlc = ? WHERE id = ?")
          .run(canonical(body), event.hlc, event.device);
        return null;
      }
      case "vault.key": {
        if (!isFullNode(signer)) return "only full nodes may create vault keys";
        const body = bodyOf(event, "vault.key");
        for (const [device, box] of Object.entries(body.grants)) {
          if (isFullNode(this.deviceAt(device, event.hlc))) this.putGrant(body.kid, device, box);
        }
        this.putLww("vault:current", event, { kid: body.kid });
        return null;
      }
      case "vault.grant": {
        if (!isFullNode(signer)) return "only full nodes may grant vault keys";
        const body = bodyOf(event, "vault.grant");
        if (!isFullNode(this.deviceAt(body.device, event.hlc))) return "grants go to active full nodes only";
        this.putGrant(body.kid, body.device, body.box);
        return null;
      }
      case "secret.set": {
        if (!isFullNode(signer)) return "only full nodes may write secrets";
        const body = bodyOf(event, "secret.set");
        this.putLww(`secret:${body.name}`, event, body as Json);
        return null;
      }
      case "secret.deleted": {
        if (!isFullNode(signer)) return "only full nodes may delete secrets";
        this.putLww(`secret:${bodyOf(event, "secret.deleted").name}`, event, null);
        return null;
      }
      case "secret.requested": {
        const body = bodyOf(event, "secret.requested");
        this.putLww(`secret-request:${body.name}`, event, body as Json);
        return null;
      }
      case "provider.set": {
        if (!isFullNode(signer)) return "only full nodes may configure providers";
        const body = bodyOf(event, "provider.set");
        this.putLww(`provider:${body.id}`, event, body as Json);
        return null;
      }
      case "provider.removed": {
        if (!isFullNode(signer)) return "only full nodes may configure providers";
        this.putLww(`provider:${bodyOf(event, "provider.removed").id}`, event, null);
        return null;
      }
      case "roster.set": {
        if (!isFullNode(signer)) return "only full nodes may change the roster";
        const body = bodyOf(event, "roster.set");
        this.putLww(`roster:${body.role}`, event, body.models);
        return null;
      }
      case "memory.added": {
        const body = bodyOf(event, "memory.added");
        const tags = body.tags ?? [];
        const trust = event.prov?.trust ?? "agent";
        this.db
          .query(
            "INSERT OR IGNORE INTO v_memories (id, text, tags, device, via, trust, hlc) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(event.id, body.text, JSON.stringify(tags), event.device, event.prov?.via ?? null, trust, event.hlc);
        this.db.query("INSERT INTO v_memories_fts (id, text, tags) VALUES (?, ?, ?)").run(event.id, body.text, tags.join(" "));
        return null;
      }
      case "memory.forgotten": {
        const { memory } = bodyOf(event, "memory.forgotten");
        this.db.query("UPDATE v_memories SET forgotten = 1 WHERE id = ?").run(memory);
        this.db.query("DELETE FROM v_memories_fts WHERE id = ?").run(memory);
        return null;
      }
      default:
        return null;
    }
  }

  private putGrant(kid: string, device: string, box: Json): void {
    this.db.query("INSERT OR REPLACE INTO v_grants (kid, device, box) VALUES (?, ?, ?)").run(kid, device, canonical(box));
  }

  /** Last-writer-wins by (hlc, id). Order-independent by construction. */
  private putLww(key: string, event: GEvent, value: Json): void {
    const current = this.db.query<{ hlc: string; eid: string }, [string]>("SELECT hlc, eid FROM v_lww WHERE k = ?").get(key);
    if (current && compareEvents({ hlc: current.hlc, id: current.eid }, event) >= 0) return;
    this.db
      .query(
        `INSERT INTO v_lww (k, hlc, eid, device, v) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (k) DO UPDATE SET hlc = excluded.hlc, eid = excluded.eid, device = excluded.device, v = excluded.v`,
      )
      .run(key, event.hlc, event.id, event.device, value === null ? null : canonical(value));
  }

  private profileHlc(device: string): string | null {
    return this.db.query<{ profile_hlc: string | null }, [string]>("SELECT profile_hlc FROM v_devices WHERE id = ?").get(device)
      ?.profile_hlc ?? null;
  }

  private anyDevices(): boolean {
    return !!this.db.query("SELECT 1 FROM v_devices LIMIT 1").get();
  }

  // ---- reading -------------------------------------------------------------

  get genesis(): { id: string; device: string; name: string } | null {
    return this.state("genesis");
  }

  device(id: string): Device | null {
    const row = this.db.query<DeviceRow, [string]>("SELECT * FROM v_devices WHERE id = ?").get(id);
    return row ? toDevice(row) : null;
  }

  /** The device as it stood at `hlc` (enrolled before, not yet revoked). */
  deviceAt(id: string, hlc: string): Device | null {
    const device = this.device(id);
    if (!device || device.enrolledHlc > hlc) return null;
    if (device.revokedHlc && device.revokedHlc <= hlc) return null;
    return device;
  }

  /** Currently active (non-revoked) device. */
  activeDevice(id: string): Device | null {
    const device = this.device(id);
    return device && !device.revokedHlc ? device : null;
  }

  devices(includeRevoked = false): Device[] {
    const rows = this.db.query<DeviceRow, []>("SELECT * FROM v_devices ORDER BY enrolled_hlc").all();
    return rows.map(toDevice).filter((d) => includeRevoked || !d.revokedHlc);
  }

  lww<T = Json>(key: string): LwwEntry<T> | null {
    const row = this.db.query<LwwRow, [string]>("SELECT * FROM v_lww WHERE k = ?").get(key);
    return row ? toLww<T>(row) : null;
  }

  lwwPrefix<T = Json>(prefix: string): LwwEntry<T>[] {
    return this.db
      .query<LwwRow, [string]>("SELECT * FROM v_lww WHERE k LIKE ? ORDER BY k")
      .all(`${prefix.replace(/[%_]/g, "")}%`)
      .map((row) => toLww<T>(row))
      .filter((entry) => entry.value !== null);
  }

  grant(kid: string, device: string): string | null {
    return this.db.query<{ box: string }, [string, string]>("SELECT box FROM v_grants WHERE kid = ? AND device = ?").get(kid, device)
      ?.box ?? null;
  }

  rejection(id: string): string | null {
    return this.db.query<{ reason: string }, [string]>("SELECT reason FROM v_rejected WHERE id = ?").get(id)?.reason ?? null;
  }

  remember(signer: NodeIdentity, text: string, opts: { tags?: string[]; prov?: Prov } = {}): GEvent {
    return this.emit(signer, "memory.added", { text, ...(opts.tags?.length ? { tags: opts.tags } : {}) }, opts.prov ?? { trust: "owner" });
  }

  /** Full-text recall (BM25). An empty query returns the most recent memories. */
  recall(query: string | undefined, limit = 20): Memory[] {
    const terms = (query ?? "").match(/[\p{L}\p{N}_]+/gu) ?? [];
    const rows = terms.length
      ? this.db
          .query<MemoryRow, [string, number]>(
            `SELECT m.* FROM v_memories_fts f JOIN v_memories m ON m.id = f.id
             WHERE v_memories_fts MATCH ? AND m.forgotten = 0 ORDER BY bm25(v_memories_fts) LIMIT ?`,
          )
          .all(terms.map((t) => `"${t}"*`).join(" OR "), limit)
      : this.db
          .query<MemoryRow, [number]>("SELECT * FROM v_memories WHERE forgotten = 0 ORDER BY hlc DESC LIMIT ?")
          .all(limit);
    return rows.map((row) => ({ ...row, tags: JSON.parse(row.tags) as string[] }));
  }

  // ---- sync ----------------------------------------------------------------

  /** Highest hlc held per device. Each device's events form a prefix, so this fully describes what we have. */
  frontier(): Record<string, string> {
    const rows = this.db.query<{ device: string; hlc: string }, []>("SELECT device, MAX(hlc) AS hlc FROM events GROUP BY device").all();
    return Object.fromEntries(rows.map((r) => [r.device, r.hlc]));
  }

  /** Events the peer described by `have` is missing, oldest first. */
  eventsSince(have: Record<string, string>, limit = 500): { events: GEvent[]; more: boolean } {
    const devices = this.db.query<{ device: string }, []>("SELECT DISTINCT device FROM events").all();
    const batch: GEvent[] = [];
    const perDevice = this.db.query<{ raw: string }, [string, string, number]>(
      "SELECT raw FROM events WHERE device = ? AND hlc > ? ORDER BY hlc, id LIMIT ?",
    );
    for (const { device } of devices) {
      for (const row of perDevice.all(device, have[device] ?? "", limit + 1)) batch.push(JSON.parse(row.raw) as GEvent);
    }
    batch.sort(compareEvents);
    return { events: batch.slice(0, limit), more: batch.length > limit };
  }

  eventCount(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get()!.n;
  }

  /** Hash of the materialized state. Equal digests ⇒ equal minds. */
  digest(): string {
    const dump = {
      state: this.db.query("SELECT k, v FROM v_state WHERE k != 'tail' ORDER BY k").all(),
      devices: this.db.query("SELECT * FROM v_devices ORDER BY id").all(),
      memories: this.db.query("SELECT * FROM v_memories ORDER BY id").all(),
      lww: this.db.query("SELECT * FROM v_lww ORDER BY k").all(),
      grants: this.db.query("SELECT * FROM v_grants ORDER BY kid, device").all(),
      rejected: this.db.query("SELECT * FROM v_rejected ORDER BY id").all(),
    };
    return sha256B64u(canonical(dump as unknown as Json));
  }
}

export const isFullNode = (device: Device | null): device is Device =>
  !!device && device.kind === "node" && device.role === "full" && !device.revokedHlc;

interface DeviceRow {
  id: string;
  name: string;
  kind: string;
  role: string;
  box: string | null;
  scopes: string;
  enrolled_by: string;
  enrolled_hlc: string;
  revoked_hlc: string | null;
  profile: string | null;
  profile_hlc: string | null;
}

const toDevice = (row: DeviceRow): Device => ({
  id: row.id,
  name: row.name,
  kind: row.kind as Device["kind"],
  role: row.role as Device["role"],
  box: row.box,
  scopes: JSON.parse(row.scopes) as Scope[],
  enrolledBy: row.enrolled_by,
  enrolledHlc: row.enrolled_hlc,
  revokedHlc: row.revoked_hlc,
  profile: row.profile ? (JSON.parse(row.profile) as Device["profile"]) : null,
});

interface MemoryRow {
  id: string;
  text: string;
  tags: string;
  device: string;
  via: string | null;
  trust: string;
  hlc: string;
}

interface LwwRow {
  k: string;
  hlc: string;
  eid: string;
  device: string;
  v: string | null;
}

const toLww = <T>(row: LwwRow): LwwEntry<T> => ({
  key: row.k,
  hlc: row.hlc,
  eid: row.eid,
  device: row.device,
  value: row.v === null ? null : (JSON.parse(row.v) as T),
});
