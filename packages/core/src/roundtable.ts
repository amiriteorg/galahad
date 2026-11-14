/*
 * The Roundtable is a technocracy: the knight best suited to a task takes it, and evidence decides, never rank.
 * Pure and zod-free (the app uses it too): the node gathers the facts (each knight's record, its tasks, its VM as
 * its host says now) and this says who takes the task, and why, in words the owner reads.
 *
 * What can't be bent is a requirement: a paused knight, one whose turns for the day are spent, one without a
 * desktop when the task needs a screen, one on another repository. Of those that can take it, a knight is weighed
 * by what is known of it: whether it is free now, how much of its work has been verified, and whether its job
 * speaks of the task's work. Ties go to the one that has done less today, then by name, so the same facts always
 * give the same knight.
 */

export interface KnightFacts {
  id: string;
  name: string;
  /** Its job, in the words it was given. */
  instructions: string;
  role: string;
  enabled: boolean;
  dailyTurns: number;
  turnsToday: number;
  repository: string | null;
  /** Its VM as its host says now; null: none made yet (one is made when a task starts). */
  vm: { image: string; status: string } | null;
  /** Its tasks, each as it stands. */
  tasks: { status: string; verified: boolean }[];
}

/** What a task requires of the knight that takes it. */
export interface TaskNeeds {
  /** A desktop in its VM (a display and a browser). */
  desktop?: boolean;
  /** The repository it must work on. */
  repository?: string;
}

export interface KnightChoice {
  id: string;
  name: string;
  reasons: string[];
}

export interface KnightConsidered {
  id: string;
  name: string;
  /** It may take the task; when not, `why` says what stands in the way. */
  eligible: boolean;
  score: number;
  why: string[];
}

/** A repository, however it is written: github.com/you/app for https://github.com/You/App.git/ and the like. */
export const repositoryKey = (url: string): string =>
  url.trim().toLowerCase().replace(/^[a-z+]+:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/+$/, "");

/** A task that speaks of a browser or a screen: a desktop is likely to help, though it is not required. */
const SCREEN = /https?:\/\/|\b(browser|website|web ?page|web site|screen|screenshot|click|desktop|sign in|log ?in|captcha)\b/i;

/** Words that say nothing of what a task is about. */
const STOP = new Set(
  "about after again also always another before being both cannot could does doing done each either every from have having into itself just keep keeps make makes made many more most much must never only other ought over same should since some such than that their them then there these they this those through under until upon very what when where which while whom whose will with within without would your yours".split(" "),
);

/** A word reduced to a stem good enough to match reviews with review and tests with test. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** The words of a text worth matching, each with its stem, in the order they appear. */
function words(text: string): { word: string; stem: string }[] {
  const seen = new Set<string>();
  const out: { word: string; stem: string }[] = [];
  for (const word of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (STOP.has(word)) continue;
    const s = stem(word);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({ word, stem: s });
  }
  return out;
}

const listed = (items: string[]): string => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Who takes a task, and why; everyone considered, best first (those that can't, after, by name). */
export function chooseKnight(goal: string, needs: TaskNeeds, knights: readonly KnightFacts[]): { choice: KnightChoice | null; considered: KnightConsidered[] } {
  const asked = new Set(words(goal).map((w) => w.stem));
  const wantsScreen = !needs.desktop && SCREEN.test(goal);
  const repository = needs.repository ? repositoryKey(needs.repository) : null;
  const considered = knights.map((k): KnightConsidered & { turnsToday: number } => {
    const hasDesktop = !!k.vm && k.vm.image.includes("desktop");
    // What can't be bent.
    const barred: string[] = [];
    if (!k.enabled) barred.push("paused");
    if (k.turnsToday >= k.dailyTurns) barred.push(`its turns for today are spent (${k.turnsToday} of ${k.dailyTurns})`);
    if (needs.desktop && !hasDesktop) barred.push(k.vm ? "its VM has no desktop" : "it has no VM with a desktop");
    if (repository) {
      if (!k.repository) barred.push("it has no repository");
      else if (repositoryKey(k.repository) !== repository) barred.push(`it works on ${repositoryKey(k.repository)}`);
    }
    if (barred.length) return { id: k.id, name: k.name, eligible: false, score: 0, why: barred, turnsToday: k.turnsToday };

    // What is known of it.
    const why: string[] = [];
    let score = 0;
    const running = k.tasks.filter((t) => t.status === "running").length;
    const queued = k.tasks.filter((t) => t.status === "queued").length;
    if (running + queued === 0) {
      score += 1;
      why.push("free now");
    } else {
      score -= running + queued;
      why.push(`busy: ${[running ? `${plural(running, "task")} running` : "", queued ? `${queued} queued` : ""].filter(Boolean).join(", ")}`);
    }
    const ended = k.tasks.filter((t) => t.status === "done" || t.status === "failed");
    const good = ended.filter((t) => t.status === "done" && t.verified).length;
    // (One verified task in one is not certainty: what is known counts as much as it is.)
    score += (2 * (good + 1)) / (ended.length + 2);
    why.push(ended.length ? `${good} of ${plural(ended.length, "task")} verified` : "no tasks yet");
    const job = words(`${k.instructions} ${k.role}`).filter((w) => asked.has(w.stem)).slice(0, 3);
    if (job.length) {
      score += 0.75 * job.length;
      why.push(`its job speaks of ${listed(job.map((w) => w.word))}`);
    }
    if (needs.desktop || (wantsScreen && hasDesktop)) {
      if (wantsScreen) score += 1;
      why.push(needs.desktop ? "has a desktop" : "has a desktop, which the task looks to need");
    }
    if (!k.vm) why.push("its VM is made when the task starts");
    else score += 0.25;
    return { id: k.id, name: k.name, eligible: true, score, why, turnsToday: k.turnsToday };
  });
  considered.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (!a.eligible) return a.name.localeCompare(b.name);
    if (a.score !== b.score) return b.score - a.score;
    if (a.turnsToday !== b.turnsToday) return a.turnsToday - b.turnsToday;
    return a.name.localeCompare(b.name);
  });
  const best = considered.find((c) => c.eligible);
  return {
    choice: best ? { id: best.id, name: best.name, reasons: best.why } : null,
    considered: considered.map(({ turnsToday: _, ...c }) => c),
  };
}
