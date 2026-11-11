import type { Station } from "@galahad/core/world";
import { STATIONS } from "@galahad/core/world";
import type { WorldAttempt, WorldCompute, WorldComputeNode } from "@galahad/core/world-compute";
import { MAX_WORLD_ATTEMPTS } from "@galahad/core/world-compute";

/*
 * Compute in the world's stream, read at the boundary: each node's slots and strength,
 * and his helpers at work (packages/core/src/world-compute.ts). Checked like every
 * world event: bounded, finite, and null rather than a guess when it can't be read.
 * Pure, so unit-tested (world-compute.test.ts).
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const count = (v: unknown, max = 10_000): v is number => num(v) && Number.isInteger(v) && v >= 0 && v <= max;
const STATION_NAMES = new Set<string>([...Object.keys(STATIONS), "field"]);

function readNode(v: unknown): WorldComputeNode | null {
  if (!isObj(v) || !text(v.id, 128) || !text(v.name, 200) || !count(v.slots) || !count(v.inUse) || !count(v.queued)) return null;
  if (!(v.strength === null || (num(v.strength) && v.strength >= 0 && v.strength <= 1e6))) return null;
  return { id: v.id, name: v.name, slots: v.slots, inUse: v.inUse, queued: v.queued, strength: v.strength as number | null };
}

function readAttempt(v: unknown): WorldAttempt | null {
  if (!isObj(v) || !text(v.id, 128) || !text(v.quest, 64) || !text(v.label, 200) || typeof v.station !== "string" || v.station.length > 32 || !num(v.since)) return null;
  if (!count(v.index, 8) || !count(v.of, 8) || v.index < 1 || v.index > v.of) return null;
  if (!(v.node === null || text(v.node, 200))) return null;
  // A station this page doesn't know yet: the helper stands at the keep rather than being lost.
  const station = (STATION_NAMES.has(v.station) ? v.station : "keep") as Station;
  return { id: v.id, quest: v.quest, index: v.index, of: v.of, label: v.label, station, node: v.node as string | null, since: v.since };
}

/** The world's compute view, checked; null when it can't be read (the world goes on without it). */
export function readCompute(v: unknown): WorldCompute | null {
  if (!isObj(v) || !Array.isArray(v.nodes) || !Array.isArray(v.attempts) || v.nodes.length > 256 || v.attempts.length > 64) return null;
  const nodes: WorldComputeNode[] = [];
  for (const raw of v.nodes) {
    const node = readNode(raw);
    if (!node) return null;
    nodes.push(node);
  }
  const attempts: WorldAttempt[] = [];
  for (const raw of v.attempts) {
    const attempt = readAttempt(raw);
    if (!attempt) return null;
    attempts.push(attempt);
  }
  return { nodes, attempts: attempts.slice(0, MAX_WORLD_ATTEMPTS) };
}

/** His helpers in a sentence, for a screen reader: "2 helpers at work: … (at Forge), …"; null when there are none. */
export function helpersLine(compute: WorldCompute | null): string | null {
  if (!compute?.attempts.length) return null;
  const n = compute.attempts.length;
  const where = (station: Station) => (station === "field" ? "in the field" : `at ${STATIONS[station].label}`);
  return `${n} helper${n === 1 ? "" : "s"} at work: ${compute.attempts.map((a) => `${a.label} (${where(a.station)})`).join(", ")}.`;
}

/** A node's compute by its device id (the world's `nodes` carry the same ids). */
export const computeOfNode = (compute: WorldCompute | null, id: string): WorldComputeNode | null => compute?.nodes.find((n) => n.id === id) ?? null;
