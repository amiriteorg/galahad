import type { QuestState, QuestView } from "./quests.ts";

/*
 * A quest in hand, as the SANDBOX draws it: on the slate that stands by the council
 * table, in chalk. Its plan (the planner's own lines), the stage he's at and the
 * command he's on, each gate ticked as it passes or crossed where it failed, and how
 * it ended; wiped a while after. No zod: the page imports this directly
 * (@galahad/core/world-quest), and reads what the stream sends with `readWorldQuests`.
 *
 * It travels in the world's hello (`quests`) and in a `quests` event when what's drawn
 * changes; pages and nodes from before it ignore both. It's a slice of the node's view
 * of quests (GET /api/quests), never of the mind's log.
 *
 * What may be drawn. The plan is a model's text: it's drawn as text (chalk on a canvas,
 * never markup), never handed to a model again, and bounded here. What a command
 * printed is never in it (no gate's output, no summary, not the command he's running):
 * only the plan, the gates' own commands and how far it's got. And nothing about the
 * bank is ever drawn in the world: a quest whose words mention the bank, or whose
 * reporter is an agent that may read the bank (the only quests whose words could carry
 * what the bank said), is drawn as its shape alone: that there is a quest, its stage,
 * its count of commands and its gates' marks, without a word of it (`veiled`).
 */

export const WORLD_QUESTS = {
  /** Quests in the slice: those in hand first, then the ones that just ended. */
  max: 4,
  /** The plan's steps drawn, and how long a line may be. */
  planLines: 7,
  line: 72,
  title: 64,
  doneWhen: 96,
  /** Gates drawn with their commands (all of them are counted). */
  gates: 6,
  gate: 44,
  /** An ended quest stays on the slate this long, then it's wiped. */
  wipeMs: 10 * 60_000,
} as const;

export interface WorldQuestGate {
  /** Its command, cut short ("" when the quest is veiled). */
  label: string;
  by: "owner" | "planner";
  /** Its last run: passed, failed, or not run yet (null). */
  passed: boolean | null;
}

export interface WorldQuest {
  /** The quest's own id, and who runs it ("you", a loop, an agent): together they name it. */
  id: string;
  by: string;
  /** With effort: which attempt this is, of how many. */
  attempt: { index: number; of: number } | null;
  state: QuestState;
  /** The goal's first words ("" when veiled). */
  title: string;
  /** The planner's steps, a line each ([] while it's planned, and when veiled). */
  plan: string[];
  /** Its "Done when:" line ("" when it has none, or veiled). */
  doneWhen: string;
  /** The command he's on (or the last he ran), and how many he may run. */
  step: number;
  maxSteps: number;
  /** Times the work was sent back. */
  revisions: number;
  /** The first gates with their commands, and how all of them stand. */
  gates: WorldQuestGate[];
  gatesPassed: number;
  gatesFailed: number;
  gatesTotal: number;
  startedAt: number;
  /** When it ended (the node's clock, ms); null while it's in hand. */
  endedAt: number | null;
  /** In hand, but its runner hasn't been heard from for a while. */
  silent: boolean;
  /** Its words are withheld (see above): only its shape is drawn. */
  veiled: boolean;
}

const IN_HAND: ReadonlySet<string> = new Set(["planning", "working", "gating", "reviewing"]);
const STATES: ReadonlySet<string> = new Set(["planning", "working", "gating", "reviewing", "done", "unverified", "gave-up", "stopped", "failed"]);

/** Whether a quest in that state is still in hand (quests.ts' questInHand, without its schema library). */
export const worldQuestInHand = (state: QuestState): boolean => IN_HAND.has(state);

/**
 * Whether words are about the bank. The world never draws anything about the bank, so a quest that
 * mentions it (in English or Danish: bank, banking, IBAN, konto, saldo, kontoudtog, Enable Banking,
 * the bank's own tools) is drawn without its words. A word screen, on purpose wider than it need be.
 */
export function aboutBank(text: string): boolean {
  return /\bbank|\biban\b|\bkonto|\bsaldo|enable\s?banking|netbank|mobilepay/i.test(text);
}

/**
 * Text fit to be chalked: one line, no control, bidirectional or zero-width characters, without
 * Markdown's emphasis and heading marks (a command keeps its own: a pipe, a glob, an underscore), cut
 * to `max` characters with an ellipsis. It's only ever drawn as text, so markup in it is just letters.
 */
export function chalkLine(text: string, max: number): string {
  const line = text
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\*\*|__|`/g, "")
    .replace(/^[#>\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...line];
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join("").trimEnd()}…` : line;
}

/**
 * A planner's plan as its steps: the numbered lines (a line that follows one is the rest of it),
 * without the "Done when:" line (given apart) and the "Gate:" lines (the gates are drawn themselves).
 * A plan with no numbers is its first lines.
 */
export function planSteps(plan: string): { steps: string[]; doneWhen: string } {
  const steps: string[] = [];
  const loose: string[] = [];
  let doneWhen = "";
  let numbered = false;
  let open = false;
  for (const raw of plan.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      open = false;
      continue;
    }
    const done = line.match(/^(?:[*_#>\s-]*)done when\s*[:：]\s*(.*)$/i);
    if (done) {
      doneWhen = done[1] ?? "";
      open = false;
      continue;
    }
    if (/^(?:[*_>\s-]*)gates?\s*[:：]/i.test(line)) {
      open = false;
      continue;
    }
    const step = line.match(/^(?:[*_>\s]*)(\d{1,2})[.)]\s*(.*)$/);
    if (step) {
      numbered = true;
      steps.push(step[2] ?? "");
      open = true;
    } else if (open && steps.length) steps[steps.length - 1] = `${steps[steps.length - 1]} ${line}`;
    else loose.push(line.replace(/^[-*•]\s+/, ""));
  }
  const lines = (numbered ? steps : loose).map((s) => chalkLine(s, WORLD_QUESTS.line)).filter(Boolean);
  return { steps: lines.slice(0, WORLD_QUESTS.planLines), doneWhen: chalkLine(doneWhen, WORLD_QUESTS.doneWhen) };
}

/** One quest as the world draws it. `veil`: its reporter may read the bank. */
export function worldQuest(view: QuestView, veil: boolean): WorldQuest {
  const words = [view.goal, view.plan ?? "", view.doing ?? "", view.summary ?? "", ...view.gates.map((g) => g.command)].join("\n");
  const veiled = veil || aboutBank(words);
  const { steps, doneWhen } = veiled ? { steps: [], doneWhen: "" } : planSteps(view.plan ?? "");
  let gatesPassed = 0;
  let gatesFailed = 0;
  for (const g of view.gates) {
    if (g.exitCode === 0) gatesPassed++;
    else if (g.exitCode !== null) gatesFailed++;
  }
  return {
    id: view.quest,
    by: chalkLine(view.by, 48),
    attempt: view.attempt ? { index: view.attempt.index, of: view.attempt.attempts } : null,
    state: view.state,
    title: veiled ? "" : chalkLine(view.goal, WORLD_QUESTS.title),
    plan: steps,
    doneWhen,
    step: view.step,
    maxSteps: view.maxSteps,
    revisions: view.revisions,
    gates: view.gates.slice(0, WORLD_QUESTS.gates).map((g) => ({ label: veiled ? "" : chalkLine(g.command, WORLD_QUESTS.gate), by: g.by, passed: g.exitCode === null ? null : g.exitCode === 0 })),
    gatesPassed,
    gatesFailed,
    gatesTotal: view.gates.length,
    startedAt: view.startedAt,
    endedAt: worldQuestInHand(view.state) ? null : view.updatedAt,
    silent: view.silent,
    veiled,
  };
}

/**
 * The quests the world draws now, from the node's own list (in hand first, the latest word first; then
 * the ones that ended): those in hand, and those that ended within WORLD_QUESTS.wipeMs. `veil` says
 * whether a quest's reporter may read the bank.
 */
export function questsForWorld(views: readonly QuestView[], now: number, veil: (view: QuestView) => boolean = () => false): WorldQuest[] {
  const out: WorldQuest[] = [];
  for (const view of views) {
    if (out.length >= WORLD_QUESTS.max) break;
    if (!worldQuestInHand(view.state) && now - view.updatedAt > WORLD_QUESTS.wipeMs) continue;
    out.push(worldQuest(view, veil(view)));
  }
  return out;
}

/** Its state in a word or two, honestly: only a reviewed quest is "done". */
export const WORLD_QUEST_STATE: Record<QuestState, string> = {
  planning: "Planning",
  working: "Working",
  gating: "Running its gates",
  reviewing: "Under review",
  done: "Done, reviewed",
  unverified: "Not accepted",
  "gave-up": "Gave up",
  stopped: "Stopped",
  failed: "Couldn't run",
};

/** Where a quest stands, in a line of fixed words (never the quest's own): "Working · command 3 of 30 · 1 of 2 gates passed". */
export function worldQuestLine(q: WorldQuest): string {
  const parts = [q.silent && worldQuestInHand(q.state) ? "No word from its runner" : WORLD_QUEST_STATE[q.state]];
  if (q.attempt) parts.push(`attempt ${q.attempt.index} of ${q.attempt.of}`);
  if (q.state !== "planning") parts.push(`command ${q.step} of ${q.maxSteps}`);
  if (q.gatesTotal) parts.push(q.gatesFailed ? `${q.gatesFailed} of ${q.gatesTotal} gate${q.gatesTotal === 1 ? "" : "s"} failed` : `${q.gatesPassed} of ${q.gatesTotal} gate${q.gatesTotal === 1 ? "" : "s"} passed`);
  if (q.revisions) parts.push(q.revisions === 1 ? "sent back once" : `sent back ${q.revisions} times`);
  return parts.join(" · ");
}

/* ---------- read at the page's boundary ---------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max * 4 ? chalkLine(v, max) : null);

function readWorldQuest(v: unknown): WorldQuest | null {
  if (!isObj(v) || typeof v.id !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(v.id) || typeof v.state !== "string" || !STATES.has(v.state)) return null;
  const by = text(v.by, 48);
  const title = text(v.title, WORLD_QUESTS.title);
  const doneWhen = text(v.doneWhen, WORLD_QUESTS.doneWhen);
  if (by === null || title === null || doneWhen === null || !Array.isArray(v.plan) || !Array.isArray(v.gates) || v.plan.length > 32 || v.gates.length > 32) return null;
  if (!int(v.step, 10_000) || !int(v.maxSteps, 10_000) || !int(v.revisions, 100) || !int(v.gatesPassed, 64) || !int(v.gatesFailed, 64) || !int(v.gatesTotal, 64)) return null;
  if (typeof v.startedAt !== "number" || !Number.isFinite(v.startedAt) || !(v.endedAt === null || (typeof v.endedAt === "number" && Number.isFinite(v.endedAt)))) return null;
  const plan: string[] = [];
  for (const line of v.plan.slice(0, WORLD_QUESTS.planLines)) {
    const read = text(line, WORLD_QUESTS.line);
    if (read === null) return null;
    if (read) plan.push(read);
  }
  const gates: WorldQuestGate[] = [];
  for (const g of v.gates.slice(0, WORLD_QUESTS.gates)) {
    if (!isObj(g) || (g.by !== "owner" && g.by !== "planner") || !(g.passed === null || typeof g.passed === "boolean")) return null;
    const label = text(g.label, WORLD_QUESTS.gate);
    if (label === null) return null;
    gates.push({ label, by: g.by, passed: g.passed });
  }
  const a = v.attempt;
  const attempt = isObj(a) && int(a.index, 8) && int(a.of, 8) && a.index >= 1 && a.of >= a.index ? { index: a.index, of: a.of } : null;
  const veiled = v.veiled === true;
  return {
    id: v.id,
    by,
    attempt,
    state: v.state as QuestState,
    // (A veiled quest has no words, whatever was sent.)
    title: veiled ? "" : title,
    plan: veiled ? [] : plan,
    doneWhen: veiled ? "" : doneWhen,
    step: v.step,
    maxSteps: Math.max(1, v.maxSteps),
    revisions: v.revisions,
    gates: veiled ? gates.map((g) => ({ ...g, label: "" })) : gates,
    gatesPassed: v.gatesPassed,
    gatesFailed: v.gatesFailed,
    gatesTotal: v.gatesTotal,
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    silent: v.silent === true,
    veiled,
  };
}

/** The stream's `quests`, checked and bounded again (one this page can't read is left out); null if it isn't a list. */
export function readWorldQuests(v: unknown): WorldQuest[] | null {
  if (!Array.isArray(v) || v.length > 64) return null;
  const out: WorldQuest[] = [];
  for (const item of v) {
    const quest = readWorldQuest(item);
    if (quest && out.length < WORLD_QUESTS.max) out.push(quest);
  }
  return out;
}
