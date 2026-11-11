import { HEARTBEAT_FINDINGS, type HeartbeatFinding, heartbeatPlace, isBankFinding, SELF_ACTION_RESOURCE, type WorldHeartbeat } from "@galahad/core";
import type { MindStore } from "@galahad/mind";
import { hlcMs, loopRecords } from "./loops.ts";

/*
 * His heartbeat, as the SANDBOX shows it: when it last ran and how, what it found that
 * still needs you (its open notices; dismissed ones don't count), where each finding is
 * in the world, and what he fixed himself after that run. Read from the mind, so every
 * node's world agrees whichever node ran it. The bank's findings stay in the inbox.
 */

const RANK = { alert: 0, warn: 1, info: 2 } as const;

interface NoticeValue {
  key: string;
  severity: "info" | "warn" | "alert";
  title: string;
  source: string;
  dismissed?: boolean;
}

/** Whether every heartbeat loop lets him fix what's safe himself (on unless one says `selfAction: false`). */
export function selfActionOn(store: MindStore): { on: boolean; heartbeats: string[] } {
  const beats = loopRecords(store).filter((l) => l.task?.kind === "heartbeat");
  return { on: beats.every((l) => l.task?.kind !== "heartbeat" || l.task.selfAction !== false), heartbeats: beats.map((l) => l.name) };
}

export function heartbeatView(store: MindStore): WorldHeartbeat | null {
  const beats = loopRecords(store).filter((l) => l.task?.kind === "heartbeat");
  const runs = beats.flatMap((l) => store.loopRuns(l.name, 1)).sort((a, b) => b.body.finished - a.body.finished);
  const last = runs[0]?.body ?? null;
  if (!beats.length && !last) return null;
  const open = store
    .lwwPrefix<NoticeValue>("notice:")
    .map((e) => e.value)
    .filter((n): n is NoticeValue => !!n && n.source === "heartbeat" && !n.dismissed && !isBankFinding(n.key));
  const counts = { info: 0, warn: 0, alert: 0 };
  for (const n of open) counts[n.severity] += 1;
  const findings: HeartbeatFinding[] = open
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.title.localeCompare(b.title))
    .slice(0, HEARTBEAT_FINDINGS)
    .map((n) => ({ key: n.key, severity: n.severity, title: n.title, ...heartbeatPlace(n.key) }));
  // What he fixed himself during that run (recorded between its start and a moment after it ended).
  const fixed = last
    ? store
        .ledger(60)
        .filter((e) => e.body.resource === SELF_ACTION_RESOURCE && hlcMs(e.hlc) >= last.started && hlcMs(e.hlc) <= last.finished + 5_000)
        .map((e) => e.body.detail ?? e.body.target)
        .slice(0, HEARTBEAT_FINDINGS)
    : [];
  return { ran: last?.finished ?? null, status: last?.status ?? null, counts, findings, fixed, selfAction: selfActionOn(store).on };
}
