import { ADVANCE, BOARD_W, type BoardItem, type BoardStroke, type Chalk, LINE, PAD, TEXT_SIZE } from "@galahad/core/board";
import { WORLD_QUEST_STATE, type WorldQuest, worldQuestInHand } from "@galahad/core/world-quest";

/*
 * His slate, as chalk: a quest in hand laid out as the same items and strokes the
 * shared chalkboard is made of, so the same chalk paints it (ui/chalk.ts) and it
 * looks written by the same hand. Pure: a quest in, marks out, in board units
 * (1600 x 900), unit-tested without a canvas.
 *
 *   QUEST · WORKING                                   (what it is, and its state)
 *   Fix the flaky sync test                           (the goal's first words)
 *   the planner's plan                                (whose words these are)
 *    1. Reproduce the failure.
 *    2. ...
 *   Done when: the suite passes ten times in a row.
 *   ─────────────────────────────────────────────
 *   plan ✓   (work)   gates   review                  (the stage he's at, ringed)
 *   commands  ||||/ ||   7 of 30                      (a tally of the commands he's run)
 *   ✓ bun test packages/link      ☐ bun run check     (each gate: passed, failed, not run)
 *
 * Everything is text and line: never markup. A veiled quest (one that touches the
 * bank: core's world-quest.ts) is drawn without a word of its own.
 */

/** What's on the slate: the marks, and where he'd stand to write each part (board units). */
export interface Slate {
  items: BoardItem[];
  strokes: BoardStroke[];
}

/** The parts he writes, each a region of the slate: he stands before it while he chalks it. */
export const SLATE_REGIONS = {
  plan: { x: 60, y: 170, w: 1100, h: 300 },
  stage: { x: 60, y: 540, w: 1200, h: 70 },
  gates: { x: 60, y: 720, w: 1400, h: 160 },
  outcome: { x: 700, y: 620, w: 800, h: 90 },
} as const;
export type SlatePart = keyof typeof SLATE_REGIONS;

const STAGES = ["plan", "work", "gates", "review"] as const;
type Stage = (typeof STAGES)[number];
const STAGE_X: Record<Stage, number> = { plan: 60, work: 380, gates: 720, review: 1080 };
/** How wide each stage's word is drawn (40 units a letter-height, about 21 a letter). */
const STAGE_W: Record<Stage, number> = { plan: 84, work: 88, gates: 105, review: 132 };

/** The stage a state is at, and whether the ones before it are behind him. */
function stageOf(q: WorldQuest): { at: Stage | null; done: number } {
  switch (q.state) {
    case "planning":
      return { at: "plan", done: 0 };
    case "working":
      return { at: "work", done: 1 };
    case "gating":
      return { at: "gates", done: 2 };
    case "reviewing":
      return { at: "review", done: 3 };
    case "done":
      return { at: null, done: 4 };
    default:
      // Ended some other way: what it had got through stays ticked (the plan, if it had one).
      return { at: null, done: q.plan.length || q.step ? 1 : 0 };
  }
}

/** How it ended, in chalk: only a reviewed quest is green. */
const OUTCOME_CHALK: Record<string, Chalk> = { done: "green", unverified: "orange", "gave-up": "orange", stopped: "white", failed: "pink" };

/** A line cut to fit the slate. */
const clip = (words: string, max: number): string => ([...words].length > max ? `${[...words].slice(0, max - 1).join("").trimEnd()}…` : words);

/** The most commands a tally shows as marks (beyond it, the number alone). */
const TALLY_MAX = 40;

/**
 * The slate for a quest (null: wiped clean). `more`: how many other quests are in hand beside it.
 * Deterministic: the same quest gives the same marks, so the face is painted again only when it changed.
 */
export function planSlate(q: WorldQuest | null, more = 0): Slate {
  const items: BoardItem[] = [];
  const strokes: BoardStroke[] = [];
  if (!q) return { items, strokes };
  let n = 0;
  const id = (kind: string) => `${kind}_slate_${String(n++).padStart(4, "0")}`;
  const text = (words: string, x: number, y: number, size: "s" | "m" | "l", color: Chalk): void => {
    if (!words) return;
    // Its box is its own line's (the painter tilts each item a hair about its middle), and never so narrow that it wraps.
    const w = Math.min(BOARD_W - x - 8, Math.ceil([...words].length * ADVANCE * TEXT_SIZE[size]) + 2 * PAD + 6);
    items.push({ kind: "text", text: words, size, id: id("i"), by: "galahad", x, y, w, h: Math.ceil(TEXT_SIZE[size] * LINE) + 2 * PAD, color, at: n });
  };
  const line = (points: number[], color: Chalk, width = 5): void => {
    strokes.push({ id: id("s"), color, width, points, at: n });
  };
  const tick = (x: number, y: number, color: Chalk = "green"): void => line([x, y + 14, x + 6, y + 22, x + 13, y + 30, x + 24, y + 12, x + 36, y - 8], color, 6);
  const cross = (x: number, y: number): void => {
    line([x, y - 4, x + 15, y + 12, x + 30, y + 28], "pink", 6);
    line([x + 30, y - 4, x + 15, y + 12, x, y + 28], "pink", 6);
  };
  const box = (x: number, y: number): void => line([x, y, x + 28, y, x + 28, y + 26, x, y + 26, x, y], "white", 3);

  const inHand = worldQuestInHand(q.state);
  // What it is, and where it stands: fixed words (never the quest's own).
  const attempt = q.attempt ? ` · attempt ${q.attempt.index} of ${q.attempt.of}` : "";
  const back = q.revisions ? ` · sent back ${q.revisions === 1 ? "once" : q.revisions === 2 ? "twice" : `${q.revisions} times`}` : "";
  const state = q.silent && inHand ? "no word from its runner" : WORLD_QUEST_STATE[q.state];
  text(`QUEST · ${state.toUpperCase()}${attempt}${back}`, 48, 14, "s", inHand ? "yellow" : (OUTCOME_CHALK[q.state] ?? "white"));
  if (more > 0) text(`+${more} more in hand`, 1270, 14, "s", "blue");
  text(q.veiled ? "A quest in hand" : q.title || "A quest", 48, 62, "m", "white");

  // The plan: the planner's own lines, said to be so. A veiled quest has none; one being planned has none yet.
  if (q.veiled) text("its words are kept off this slate", 48, 132, "s", "blue");
  else if (!q.plan.length) text(q.state === "planning" ? "the planner is writing the plan…" : "no plan was written down", 48, 132, "s", "blue");
  else {
    text("the planner's plan", 48, 132, "s", "blue");
    items.push({ kind: "note", text: q.plan.map((step, i) => `${i + 1}. ${step}`).join("\n"), id: id("i"), by: "galahad", x: 60, y: 176, w: 1240, h: Math.ceil(q.plan.length * 28 * LINE) + 2 * PAD, color: "white", at: n });
    if (q.doneWhen) text(clip(`Done when: ${q.doneWhen}`, 94), 48, 458, "s", "blue");
  }

  // A line under the plan, a little unsteady, as a hand rules one.
  line([48, 528, 420, 524, 800, 529, 1180, 525, 1552, 528], "white", 3);

  // The stage he's at, ringed; the ones behind him, ticked.
  const stage = stageOf(q);
  STAGES.forEach((name, i) => {
    if (name === "gates" && !q.gatesTotal) return;
    const x = STAGE_X[name];
    text(name, x, 536, "m", stage.at === name ? "yellow" : "white");
    const done = name === "gates" ? stage.done > 2 : name === "review" ? stage.done > 3 : i < stage.done;
    if (done) tick(x + STAGE_W[name] + 34, 566);
    if (stage.at === name) {
      // A ring round the word: an ellipse in twelve strokes of the wrist, not quite closed.
      const cx = x + 12 + STAGE_W[name] / 2;
      const cy = 578;
      const pts: number[] = [];
      for (let k = 0; k <= 13; k++) {
        const a = -2.2 + (k / 13) * Math.PI * 2.08;
        pts.push(Math.round(cx + Math.cos(a) * (STAGE_W[name] / 2 + 30)), Math.round(cy + Math.sin(a) * 34));
      }
      line(pts, "yellow", 4);
    }
  });

  // How it ended, written large; or the commands he's run so far, as a tally.
  if (!inHand) {
    text(WORLD_QUEST_STATE[q.state], SLATE_REGIONS.outcome.x, 616, "l", OUTCOME_CHALK[q.state] ?? "white");
    if (q.state === "done") {
      const x = SLATE_REGIONS.outcome.x + 430;
      line([x, 668, x + 14, 686, x + 30, 704, x + 62, 650, x + 96, 606], "green", 9);
    }
  }
  if (q.state !== "planning") {
    text("commands", 48, 632, "s", "white");
    let x = 220;
    if (q.step <= TALLY_MAX) {
      for (let k = 1; k <= q.step; k++) {
        if (k % 5 === 0) {
          // The fifth strikes through the four before it.
          line([x - 62, 690, x - 30, 672, x + 2, 652], "white", 4);
          x += 22;
        } else {
          line([x, 650 + (k % 2), x + 1, 672, x - 1, 694], "white", 4);
          x += 15;
        }
      }
      if (q.step % 5 !== 0) x += 14;
    }
    if (inHand || q.step > TALLY_MAX) text(`${q.step} of ${q.maxSteps}`, Math.min(x + 8, 560), 632, "s", "white");
    else text(String(q.step), Math.min(x + 8, 560), 632, "s", "white");
  }

  // The gates: each ticked as it passes, crossed where it failed, an empty box until it's run.
  // (Six places: when there are more gates than that, the last place says how many more.)
  const unseen = q.gatesTotal > q.gates.length || q.gates.length > 6 ? q.gatesTotal - Math.min(q.gates.length, 5) : 0;
  const drawn = unseen > 0 ? q.gates.slice(0, 5) : q.gates.slice(0, 6);
  if (unseen > 0) text(`+${unseen} more gate${unseen === 1 ? "" : "s"}`, 60 + 760 + 40, 718 + 2 * 56, "s", "blue");
  drawn.forEach((gate, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 60 + col * 760;
    const y = 718 + row * 56;
    if (gate.passed === true) tick(x - 2, y + 22);
    else if (gate.passed === false) cross(x, y + 20);
    else box(x, y + 22);
    text(q.veiled || !gate.label ? `gate ${i + 1}` : gate.label, x + 40, y, "s", gate.by === "planner" ? "blue" : "white");
  });
  return { items, strokes };
}

/** What makes the slate's face: it's painted again only when this changes. */
export function slateKey(q: WorldQuest | null, more = 0): string {
  if (!q) return "";
  return JSON.stringify([q.id, q.by, q.attempt, q.state, q.title, q.plan, q.doneWhen, q.step, q.maxSteps, q.revisions, q.gates, q.gatesTotal, q.silent, q.veiled, more]);
}

/**
 * What he has to chalk when the slate changes from one quest's standing to the next: the plan when it's first
 * there, the gates when one was run, the outcome when it ended. Null: nothing worth walking over for (a command
 * more on the tally, a slate wiped).
 */
export function slateChore(prev: WorldQuest | null, next: WorldQuest | null): SlatePart | null {
  if (!next) return null;
  const same = prev !== null && prev.id === next.id && prev.by === next.by;
  if (!worldQuestInHand(next.state)) return !same || worldQuestInHand(prev!.state) ? "outcome" : null;
  if (next.plan.length && (!same || !prev!.plan.length)) return "plan";
  if (same && next.gates.some((g, i) => g.passed !== null && g.passed !== prev!.gates[i]?.passed)) return "gates";
  if (same && next.state !== prev!.state) return "stage";
  return null;
}
