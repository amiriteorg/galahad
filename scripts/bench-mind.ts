// What the mind's periodic work costs as the log grows.
//
//   bun scripts/bench-mind.ts                 5k, 40k and 400k events (400k takes a few minutes to sign)
//   bun scripts/bench-mind.ts 5000 40000      just these sizes
//
// Each size gets its own temp home with a three-node fleet (a founder, a sandbox host that
// writes most of the log, and one more node) and a log shaped like a real one: mostly ledger
// entries (every sandbox exec is one), loop runs, memories and notices. Every event is really
// signed and chained; they're written straight into the log and the views rebuilt, as if they
// had arrived over months. Then each operation the daemon does on a timer is timed (median of
// several runs). Nothing here touches ~/.galahad.
import { Database } from "bun:sqlite";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64u, decodeHlc, encodeHlc, type GEvent, HlcClock, type Json, newNodeIdentity, type NodeIdentity, signEvent } from "../packages/core/src/index.ts";
import { enrollDevice, foundFleet, MindStore, PullState } from "../packages/mind/src/index.ts";

const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
const SIZES = sizes.length ? sizes : [5_000, 40_000, 400_000];
const RUNS = 7;

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function time(fn: () => unknown, runs = RUNS): number {
  fn(); // warm the statement cache
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  return median(samples);
}

interface Fleet {
  dir: string;
  path: string;
  a: NodeIdentity;
  b: NodeIdentity;
  c: NodeIdentity;
  /** Ids of a few of b's older events, to punch holes with. */
  oldB: string[];
}

/** A log of `n` signed, chained events from three nodes, written in bulk, views rebuilt. */
function build(n: number): Fleet {
  const dir = mkdtempSync(join(tmpdir(), "galahad-bench-"));
  const path = join(dir, "mind.db");
  const a = newNodeIdentity();
  const b = newNodeIdentity();
  const c = newNodeIdentity();
  // The fleet was founded long enough ago for one event a second up to an hour ago.
  const founded = Date.now() - (n + 7_200) * 1_000;
  const store = new MindStore(path, new HlcClock(() => founded));
  foundFleet(store, a, { fleetName: "bench", nodeName: "founder" });
  enrollDevice(store, a, { device: b.id, name: "sandbox-host", kind: "node", box: b64u(b.boxPublic) });
  enrollDevice(store, a, { device: c.id, name: "third", kind: "node", box: b64u(c.boxPublic) });
  const loops: [NodeIdentity, string][] = [[b, "heartbeat"], [c, "poll"], [a, "backup"]];
  for (const [node, name] of loops) {
    store.emit(a, "loop.set", { name, schedule: "every 30m", on: node.id, enabled: true, task: { kind: "heartbeat" } });
  }
  const fleet = store.fleet!;
  const heads = new Map<string, string | null>([a, b, c].map((node) => [node.id, store.head(node.id)]));
  const slots = new Map<string, number>();
  // Strictly increasing timestamps after the fleet was set up, ending about an hour ago.
  const startMs = founded + 1_000;
  const insert = store.db.query("INSERT INTO events (id, hlc, device, kind, raw) VALUES (?, ?, ?, ?, ?)");
  const oldB: string[] = [];
  let seed = 7;
  const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  let batch: GEvent[] = [];
  const flush = () => {
    store.db.transaction(() => {
      for (const event of batch) insert.run(event.id, event.hlc, event.device, event.kind, JSON.stringify(event));
    })();
    batch = [];
  };
  for (let i = 0; i < n; i++) {
    // The last few are the sandbox host's, so an event from `c` can arrive "late" (out of order).
    const r = random();
    const node = i >= n - 5 ? b : r < 0.7 ? b : r < 0.85 ? a : c;
    const loop = loops.find(([owner]) => owner === node)![1];
    const k = random();
    const hlc = encodeHlc({ ms: startMs + i * 1_000, counter: 0 });
    let kind: string;
    let body: unknown;
    if (k < 0.85) {
      kind = "ledger.recorded";
      body = { class: "create", resource: "sandbox.exec", target: `sb${(i % 997).toString(16)}`, verdict: "allow", quest: `q${i % 50}`, detail: `python3 -c "print(${i})"` };
    } else if (k < 0.93) {
      const slot = (slots.get(loop) ?? 1_700_000_000_000) + 1_800_000;
      slots.set(loop, slot);
      kind = "loop.ran";
      body = { loop, run: `s${slot.toString(36)}`, slot, status: "ok", started: slot, finished: slot + 1_000, summary: "All quiet." };
    } else if (k < 0.97) {
      kind = "memory.added";
      body = { text: `observation ${i}: the build took ${Math.round(random() * 100)} seconds`, tags: ["bench"] };
    } else {
      kind = "notice.raised";
      body = { key: `bench:${i % 20}`, severity: "info", title: "Bench notice", body: `number ${i}`, source: "heartbeat", at: startMs + i * 1_000 };
    }
    const event = signEvent({ v: 2, fleet, hlc, device: node.id, prev: heads.get(node.id) ?? null, kind, body: body as never }, node);
    heads.set(node.id, event.id);
    if (node === b && oldB.length < 4 && i > n / 10) oldB.push(event.id);
    batch.push(event);
    if (batch.length >= 5_000) flush();
  }
  flush();
  store.rebuild();
  const rejected = store.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM v_rejected").get()!.n;
  if (rejected) throw new Error(`the generated log should be valid, but ${rejected} events were rejected`);
  store.close();
  return { dir, path, a, b, c, oldB };
}

/** An event from `c`, dated after its own head but before the log's newest event: it arrived late. */
function lateEvent(store: MindStore, c: NodeIdentity, kind: "ledger.recorded" | "memory.added"): GEvent {
  const head = store.event(store.head(c.id)!)!;
  const { ms, counter } = decodeHlc(head.hlc);
  const body: Json = kind === "ledger.recorded" ? { class: "read", resource: "bench", target: "late", verdict: "allow" } : { text: "a late thought" };
  return signEvent({ v: 2, fleet: store.fleet!, hlc: encodeHlc({ ms, counter: counter + 1 }), device: c.id, prev: head.id, kind, body }, c);
}

type Row = Record<string, string>;

function bench(n: number): Row {
  const started = performance.now();
  const fleet = build(n);
  const built = performance.now() - started;
  const row: Row = { events: n.toLocaleString("en-US") };
  const opened: MindStore[] = [];
  try {
    let openMs = 0;
    {
      const t = performance.now();
      new MindStore(fleet.path).close();
      openMs = performance.now() - t;
    }
    const store = new MindStore(fleet.path);
    opened.push(store);
    const self = { have: store.frontier(), digests: store.deviceDigests() };
    // A peer missing one of b's older events (a partial delivery).
    const holePath = join(fleet.dir, "hole.db");
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    copyFileSync(fleet.path, holePath);
    const hole = new MindStore(holePath);
    hole.db.query("DELETE FROM events WHERE id = ?").run(fleet.oldB[0]!);
    hole.rebuild();
    const holed = { have: hole.frontier(), digests: hole.deviceDigests() };
    hole.close();
    // A peer ten events behind on the sandbox host.
    const recent = store.db
      .query<{ hlc: string }, [string]>("SELECT hlc FROM events WHERE device = ? ORDER BY hlc DESC LIMIT 1 OFFSET 10")
      .get(fleet.b.id)!.hlc;
    const behind = { have: { ...self.have, [fleet.b.id]: recent }, digests: self.digests };

    row["open"] = openMs.toFixed(1);
    // First start on a replica from before schema versions: the same log, the old schema.
    {
      const old = join(fleet.dir, "old.db");
      copyFileSync(holePath, old);
      const raw = new Database(old);
      raw.exec(`DROP TABLE IF EXISTS log_devices; DROP TABLE IF EXISTS v_slots; DROP TABLE IF EXISTS v_chainbad;
        DROP INDEX IF EXISTS events_kind; DROP INDEX IF EXISTS events_loop; DROP INDEX IF EXISTS events_device_order;
        CREATE INDEX IF NOT EXISTS events_device ON events (device, hlc); PRAGMA user_version = 0;`);
      raw.close();
      const t = performance.now();
      new MindStore(old).close();
      row["first start, migrating"] = (performance.now() - t).toFixed(0);
    }
    row["frontier"] = time(() => store.frontier()).toFixed(1);
    row["deviceDigests"] = time(() => store.deviceDigests()).toFixed(1);
    row["eventsSince in sync"] = time(() => store.eventsSince(self.have, 500, self.digests)).toFixed(1);
    row["eventsSince 10 behind"] = time(() => store.eventsSince(behind.have, 500, behind.digests)).toFixed(1);
    let holeEvents = 0;
    row["eventsSince hole"] = time(() => (holeEvents = store.eventsSince(holed.have, 500, holed.digests).events.length), 3).toFixed(1);
    row["hole page size"] = String(holeEvents);
    row["lastSlot"] = time(() => store.lastSlot("heartbeat", fleet.b.id)).toFixed(2);
    row["loopRuns(1)"] = time(() => store.loopRuns("heartbeat", 1)).toFixed(2);
    row["loopRuns never ran"] = time(() => store.loopRuns("never-ran", 1)).toFixed(2);
    row["ledger(200)"] = time(() => store.ledger(200)).toFixed(1);
    row["eventCount"] = time(() => store.eventCount()).toFixed(1);
    row["state digest"] = time(() => store.digest()).toFixed(1);
    row["emit (append)"] = time(() => store.remember(fleet.a, "one more thing", { prov: { trust: "agent" } })).toFixed(2);
    // Each late arrival is a fresh event; time only its ingest. A late ledger entry is the
    // common case (a busy node's sandbox execs reaching the others); a late memory still replays.
    for (const kind of ["ledger.recorded", "memory.added"] as const) {
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const event = lateEvent(store, fleet.c, kind);
        const t = performance.now();
        const result = store.ingest([event]);
        if (result.added !== 1) throw new Error(`a late arrival should be added: ${JSON.stringify(result)}`);
        samples.push(performance.now() - t);
      }
      row[kind === "memory.added" ? "late memory" : "late ledger entry"] = median(samples).toFixed(1);
    }
    // The holed peer pulls until it's whole: every page, both sides, end to end.
    {
      const holedStore = new MindStore(holePath);
      opened.push(holedStore);
      const pull = new PullState(holedStore);
      pull.begin();
      let pages = 0;
      let slowest = 0;
      const t = performance.now();
      for (;;) {
        const page = performance.now();
        const { have, sets } = pull.request(true);
        const more = pull.receive(store.eventsSince(have, 500, sets)).more;
        slowest = Math.max(slowest, performance.now() - page);
        pages++;
        if (!more) break;
      }
      row["hole repair, end to end"] = (performance.now() - t).toFixed(0);
      row["hole repair, pages"] = String(pages);
      row["hole repair, slowest page"] = slowest.toFixed(1);
      if (holedStore.event(fleet.oldB[0]!) === null) throw new Error("the hole wasn't repaired");
    }
    const duplicates = store.eventsSince({}, 500).events;
    row["ingest 500 duplicates"] = time(() => store.ingest(duplicates), 3).toFixed(0);
    row["full rebuild"] = time(() => store.rebuild(), 3).toFixed(0);
  } finally {
    for (const s of opened) s.close();
    try {
      rmSync(fleet.dir, { recursive: true, force: true });
    } catch (error) {
      console.error(`  (left ${fleet.dir}: ${(error as Error).message})`);
    }
  }
  console.error(`  ${n} events: built in ${(built / 1000).toFixed(1)} s`);
  return row;
}

const rows: Row[] = [];
for (const n of SIZES) {
  console.error(`building ${n} events…`);
  rows.push(bench(n));
}
const keys = Object.keys(rows[0]!);
console.log(`| Operation (ms, median) | ${rows.map((r) => r.events).join(" | ")} |`);
console.log(`|---|${rows.map(() => "---:").join("|")}|`);
for (const key of keys.slice(1)) console.log(`| ${key} | ${rows.map((r) => r[key]).join(" | ")} |`);
