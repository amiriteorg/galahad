import { type QuestProgressInput, questInHand, questsForWorld, type QuestView, redact, type WorldQuest } from "@galahad/core";

/*
 * The quests in hand, as this node shows them: whoever runs a quest (a terminal's
 * `galahad do`, a loop here) reports where it stands, and every device sees the plan,
 * the step he's on and each gate's last result.
 *
 * A view, not a record: in memory, bounded, and gone with the node (the ledger has every
 * command, the mind the outcome). Each reporter has its own quests, so an agent can't
 * write over yours; everything shown is redacted again here.
 */

/** A quest in hand not heard from for this long is shown as silent (its runner may be gone). */
export const QUEST_SILENT_MS = 20 * 60_000;
/** Ended quests stay on show this long. */
const KEEP_ENDED_MS = 24 * 60 * 60_000;
const MAX_QUESTS = 200;
const MAX_PER_REPORTER = 40;

interface Entry {
  by: string;
  progress: QuestProgressInput;
  startedAt: number;
  updatedAt: number;
  /** Its reporter may read the bank (an agent granted bank:read): the world draws its shape, never its words. Once so, it stays so. */
  bank: boolean;
}

export class QuestBoard {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Called after every report (the world's slate follows: world-hub.ts). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Where a quest stands, as its runner says. `by`: who that is ("you", a loop, an agent); `bank`: whether that reporter may read the bank. */
  report(by: string, progress: QuestProgressInput, opts: { bank?: boolean } = {}): void {
    const key = `${by}\n${progress.quest}`;
    const at = this.now();
    const clean: QuestProgressInput = {
      ...progress,
      goal: redact(progress.goal),
      ...(progress.plan !== undefined ? { plan: redact(progress.plan) } : {}),
      ...(progress.doing !== undefined ? { doing: redact(progress.doing) } : {}),
      ...(progress.summary !== undefined ? { summary: redact(progress.summary) } : {}),
      gates: progress.gates.map((g) => ({ ...g, command: redact(g.command), ...(g.excerpt !== undefined ? { excerpt: redact(g.excerpt) } : {}) })),
    };
    const known = this.entries.get(key);
    // An ended quest stays ended: a late report from a step that was still in flight doesn't bring it back.
    if (known && !questInHand(known.progress.state) && questInHand(clean.state)) return;
    this.entries.delete(key);
    this.entries.set(key, { by, progress: clean, startedAt: known?.startedAt ?? at, updatedAt: at, bank: Boolean(opts.bank) || Boolean(known?.bank) });
    this.trim(by);
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* a listener's problem */
      }
    }
  }

  /**
   * The quests the SANDBOX draws on his slate (core's world-quest.ts): those in hand and those that just ended,
   * bounded, without anything a command printed; a quest whose reporter may read the bank, or whose words
   * mention it, as its shape alone.
   */
  world(): WorldQuest[] {
    const bank = new Set<string>();
    for (const e of this.entries.values()) if (e.bank) bank.add(`${e.by}\n${e.progress.quest}`);
    return questsForWorld(this.list(), this.now(), (q) => bank.has(`${q.by}\n${q.quest}`));
  }

  /** In hand first (the latest word first), then the ones that ended, most recent first. */
  list(): QuestView[] {
    const now = this.now();
    for (const [key, entry] of this.entries) if (!questInHand(entry.progress.state) && now - entry.updatedAt > KEEP_ENDED_MS) this.entries.delete(key);
    return [...this.entries.values()]
      .map((e): QuestView => ({ ...e.progress, by: e.by, startedAt: e.startedAt, updatedAt: e.updatedAt, silent: questInHand(e.progress.state) && now - e.updatedAt > QUEST_SILENT_MS }))
      .sort((a, b) => Number(questInHand(b.state)) - Number(questInHand(a.state)) || b.updatedAt - a.updatedAt);
  }

  private trim(by: string): void {
    const mine = [...this.entries].filter(([, e]) => e.by === by);
    // The oldest of a reporter's go first, ended ones before any in hand.
    const spare = (list: [string, Entry][], over: number): void => {
      const order = [...list].sort(([, a], [, b]) => Number(questInHand(a.progress.state)) - Number(questInHand(b.progress.state)) || a.updatedAt - b.updatedAt);
      for (const [key] of order.slice(0, Math.max(0, over))) this.entries.delete(key);
    };
    spare(mine, mine.length - MAX_PER_REPORTER);
    spare([...this.entries], this.entries.size - MAX_QUESTS);
  }
}
