import type { TeamTask } from "@galahad/core/team";

/*
 * What a task's card says, in words (pure: no DOM). Where it stands, how it ended and why, what the knight
 * said of it, what can be done with it, who gave it to the Roundtable, and what it kept. The card shows these;
 * views/task-card.ts draws them.
 */

type Tone = "ok" | "warn" | "danger" | "accent" | "neutral";

/** Where a task stands, toned as status is everywhere: green only for verified work. */
export function taskBadge(task: Pick<TeamTask, "status" | "verified">): { text: string; tone: Tone } {
  switch (task.status) {
    case "proposed": return { text: "Waiting for you", tone: "accent" };
    case "queued": return { text: "Queued", tone: "neutral" };
    case "running": return { text: "Running", tone: "accent" };
    case "done": return task.verified ? { text: "Verified", tone: "ok" } : { text: "Not verified", tone: "warn" };
    case "failed": return { text: "Failed", tone: "danger" };
    case "stopped": return { text: "Stopped", tone: "neutral" };
    case "interrupted": return { text: "Interrupted", tone: "warn" };
  }
}

/** How a knight's quest can end, as the runner records it on a task that wasn't verified. */
const QUEST_ENDS: Readonly<Record<string, string>> = {
  "gave-up": "It gave up.",
  unverified: "Not verified: its gates or the independent review did not pass.",
  stopped: "It stopped before the work was done.",
};

/** When nothing was recorded of why. */
const UNSAID: Readonly<Record<string, string>> = { failed: "It failed without saying why.", stopped: "Stopped.", interrupted: "Interrupted. Review it before resuming.", done: "The work was not independently verified." };

/** As much of what the knight said as a card shows. */
const SAID = 1000;

/**
 * How a task ended: why it wasn't verified (null: it was), and what the knight said of it, its own summary before the
 * runner's lines (null: nothing). Null for work still in hand.
 */
export function taskEnd(task: Pick<TeamTask, "status" | "verified" | "error" | "output">): { why: string | null; said: string | null } | null {
  if (task.status === "proposed" || task.status === "queued" || task.status === "running") return null;
  const summary = task.output.split("\n\nReview:")[0]!.trim();
  const said = !summary || summary.startsWith("Review:") ? null : summary.length > SAID ? `${summary.slice(0, SAID - 1)}…` : summary;
  if (task.status === "done" && task.verified) return { why: null, said };
  const error = task.error?.trim();
  return { why: (error && (QUEST_ENDS[error] ?? error)) || UNSAID[task.status]!, said };
}

export type TaskAction = "approve" | "decline" | "stop" | "resume" | "again";

/** What can be done with a task: a proposal approved or declined, work in hand stopped, work that ended unverified
 * resumed or given again. */
export function taskActions(task: Pick<TeamTask, "status" | "verified">): TaskAction[] {
  if (task.status === "proposed") return ["approve", "decline"];
  if (task.status === "queued" || task.status === "running") return ["stop"];
  if (task.status === "done") return task.verified ? [] : ["again"];
  return ["resume", "again"];
}

/** Who gave a task to the Roundtable rather than to a knight by name (null: it was given by name). */
export const givenLine = (task: Pick<TeamTask, "givenBy">): string | null =>
  task.givenBy === "owner" ? "Given to the Roundtable by you" : task.givenBy === "galahad" ? "Given to the Roundtable by Galahad" : null;

/** Who wrote a task, when a knight did (null: you or Galahad gave it): `proposer` is that knight's name. */
export const proposedLine = (task: Pick<TeamTask, "proposedBy" | "status">, proposer: string | null): string | null =>
  !task.proposedBy ? null : task.status === "proposed" ? `${proposer ?? task.proposedBy} proposes this: it starts when you approve it` : `Proposed by ${proposer ?? task.proposedBy}`;

/** What a task kept of its changes: how many files, and the artifact that holds them (null: nothing kept). */
export const keptChanges = (task: Pick<TeamTask, "changes">): { text: string; artifact: string } | null =>
  task.changes ? { text: `${task.changes.files} file${task.changes.files === 1 ? "" : "s"} changed`, artifact: task.changes.artifact } : null;
