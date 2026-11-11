import { SELF_ACTION_QUEST, SELF_ACTION_RESOURCE, SELF_ACTIONS, SelfAction, selfActionTarget, selfActionTitle } from "@galahad/core";
import { OFFLINE_AFTER_MS } from "./heartbeat.ts";

/*
 * After each heartbeat, Galahad fixes what's on the self-action allowlist himself
 * (packages/core/src/self-action.ts) and leaves everything else to you as notices
 * and approvals, as the oath says.
 *
 *   plan     pure: a snapshot of this node in, the fixes it calls for out;
 *   act      each fix is parsed against the allowlist (anything else is refused),
 *            checked again against a fresh snapshot (it must be exactly a fix the
 *            plan calls for now), carried out by the node's own hands (the oath
 *            gate still decides a sandbox's removal), and recorded in the ledger
 *            as his own.
 *
 * Nothing here can reach a connector, the vault, devices, the roster, the bank or
 * anything that needs fleet:admin: the hands below are all it has.
 */

/** What the plan reads: this node's own sandboxes, loops and weather. */
export interface SelfSnapshot {
  now: number;
  /** This node's sandboxes (null: not a sandbox host, or Docker didn't answer). */
  sandboxes: { id: string; expiresAt: number; ephemeral: boolean; quest: string }[] | null;
  /** Loops this node runs: whether they only read, whether one is running now, their latest runs (newest first). */
  loops: { name: string; readOnly: boolean; running: boolean; recent: { run: string; status: string; finished: number }[] }[];
  /** Failed runs he has already run again (from the ledger), so none is retried twice. */
  retried: string[];
  /** The world's weather: fetched at all here, someone has the world open, and it's known now. */
  weather: { enabled: boolean; watched: boolean; known: boolean } | null;
}

/** At most this many fixes after one heartbeat. */
export const MAX_SELF_ACTIONS = 8;
/** A failed run older than this isn't retried (the next scheduled run is near, or it's old news). */
export const RETRY_WITHIN_MS = 6 * 60 * 60_000;

/** The fixes a snapshot calls for, in order: sandboxes, then loops, then the weather. Pure. */
export function planSelfActions(s: SelfSnapshot): SelfAction[] {
  const out: SelfAction[] = [];
  for (const box of s.sandboxes ?? []) {
    // The heartbeat's own rule for "the reaper missed it" (sandbox-overdue): ephemeral, and past its expiry by the grace.
    if (box.ephemeral && s.now - box.expiresAt >= OFFLINE_AFTER_MS) out.push({ kind: "reap-sandbox", sandbox: box.id });
  }
  const retried = new Set(s.retried);
  // A bad run of a loop that only reads: it failed, or its service answered with an error (attention).
  const bad = (status: string | undefined) => status === "failed" || status === "attention";
  for (const loop of s.loops) {
    const [last, before] = loop.recent;
    if (!loop.readOnly || loop.running || !last || !bad(last.status)) continue;
    // Once: not after two bad runs in a row, not twice for the same run, not for old news.
    if (bad(before?.status) || retried.has(last.run) || s.now - last.finished > RETRY_WITHIN_MS) continue;
    out.push({ kind: "retry-loop", loop: loop.name, after: last.run });
  }
  if (s.weather?.enabled && s.weather.watched && !s.weather.known) out.push({ kind: "refresh-weather" });
  return out.slice(0, MAX_SELF_ACTIONS);
}

/** The node's hands for the allowlist, and nothing else. */
export interface SelfActionHands {
  /** Destroy one sandbox through the oath gate, on behalf of the quest that made it. */
  reap(sandbox: string, quest: string): Promise<{ verdict: string; reason: string }>;
  /** Start one run of a loop now (it doesn't count as its scheduled run). */
  retry(loop: string): void;
  /** Ask for Denmark's weather again (the weather service keeps its own pace). */
  refreshWeather(): Promise<void>;
}

export interface LedgerWrite {
  class: "read" | "create" | "modify" | "delete";
  resource: string;
  target: string;
  verdict: "allow";
  reason: string;
  quest: string;
  detail: string;
}

export interface SelfActionOutcome {
  action: SelfAction;
  ok: boolean;
  /** "Removed sandbox 0123456789, which had outlived its time" (or why it didn't). */
  title: string;
}

export class SelfActionRefused extends Error {}

const same = (a: SelfAction, b: SelfAction): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Carries out one fix, or refuses it: it must parse as an allowlisted action and be exactly one the
 * plan calls for in `fresh` (taken just before). Recorded in the ledger as his own either way it ran.
 */
export async function runSelfAction(raw: unknown, fresh: SelfSnapshot, hands: SelfActionHands, ledger: (entry: LedgerWrite) => void): Promise<SelfActionOutcome> {
  const parsed = SelfAction.safeParse(raw);
  if (!parsed.success) throw new SelfActionRefused("not on the self-action allowlist");
  const action = parsed.data;
  if (!planSelfActions(fresh).some((wanted) => same(wanted, action))) throw new SelfActionRefused("nothing calls for it now");
  const title = selfActionTitle(action);
  let ok = true;
  let why = "";
  try {
    switch (action.kind) {
      case "reap-sandbox": {
        const box = fresh.sandboxes!.find((b) => b.id === action.sandbox)!;
        const decision = await hands.reap(box.id, box.quest);
        if (decision.verdict !== "allow") {
          ok = false;
          why = `the oath gate said ${decision.verdict}: ${decision.reason}`;
        }
        break;
      }
      case "retry-loop":
        hands.retry(action.loop);
        break;
      case "refresh-weather":
        await hands.refreshWeather();
        break;
    }
  } catch (error) {
    ok = false;
    why = String((error as Error)?.message ?? error).slice(0, 300);
  }
  ledger({
    class: SELF_ACTIONS[action.kind].class,
    resource: SELF_ACTION_RESOURCE,
    target: selfActionTarget(action),
    verdict: "allow",
    reason: ok ? `Galahad's own fix after the heartbeat: ${SELF_ACTIONS[action.kind].why}` : `Galahad's own fix didn't work: ${why}`,
    quest: SELF_ACTION_QUEST,
    detail: title,
  });
  return { action, ok, title: ok ? title : `Tried: ${title.charAt(0).toLowerCase()}${title.slice(1)} (${why})` };
}

/** Plans from one snapshot, checks each fix against a fresh one, and carries out what still stands. */
export async function selfAct(first: SelfSnapshot, fresh: () => Promise<SelfSnapshot>, hands: SelfActionHands, ledger: (entry: LedgerWrite) => void): Promise<SelfActionOutcome[]> {
  const plan = planSelfActions(first);
  if (!plan.length) return [];
  const now = await fresh();
  const out: SelfActionOutcome[] = [];
  for (const action of plan) {
    try {
      out.push(await runSelfAction(action, now, hands, ledger));
    } catch (error) {
      if (!(error instanceof SelfActionRefused)) throw error;
      // It no longer stands (the reaper got there first, the loop ran): nothing to do.
    }
  }
  return out;
}
