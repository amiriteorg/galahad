import type { TeamMessage, TeamRoom, TeamTask, TeamTaskInput } from "@galahad/core/team";

/*
 * A knight is one timeline: what was said and the tasks it was given, in the order they
 * happened. Pure (no DOM). A task sits where it was given and stays there while it runs
 * and after it ends, so nothing in the timeline moves under you.
 */

export type TimelineItem = { kind: "message"; key: string; at: number; message: TeamMessage } | { kind: "task"; key: string; at: number; task: TeamTask };

/**
 * `since`: where the words begin, when the node sent only the latest of them. Tasks that ended before it are left
 * out with the words they went with; work still in hand is always there.
 */
export function timeline(messages: readonly TeamMessage[], tasks: readonly TeamTask[], options: { since?: number } = {}): TimelineItem[] {
  const said: TimelineItem[] = messages.map((message) => ({ kind: "message", key: message.id, at: message.createdAt, message }));
  const shown = options.since === undefined ? tasks : tasks.filter((task) => task.createdAt >= options.since! || task.status === "queued" || task.status === "running");
  // (The node lists tasks latest first: turned round, two given at the same moment keep the order they were given in.)
  const given: TimelineItem[] = [...shown].reverse().map((task) => ({ kind: "task", key: `task:${task.id}`, at: task.createdAt, task }));
  // A stable sort: at the same moment, the words come before the work they asked for.
  return [...said, ...given].sort((a, b) => a.at - b.at);
}

/** The tasks a conversation's timeline holds: for a knight's own, every task given to it, wherever; for a room, the room's. */
export function timelineTasks(room: Pick<TeamRoom, "id" | "direct" | "members">, all: readonly TeamTask[]): TeamTask[] {
  const knight = room.direct && room.members.length === 1 ? room.members[0] : null;
  return all.filter((task) => (knight ? task.assignee === knight : task.room === room.id));
}

/** The same task, given again as a new one: what was asked, of whom and where. Nothing of how the first one went. */
export const giveAgain = (task: Pick<TeamTask, "room" | "assignee" | "title" | "goal" | "gates" | "dependsOn">): TeamTaskInput =>
  ({ room: task.room, assignee: task.assignee, title: task.title.trim(), goal: task.goal, gates: [...task.gates], dependsOn: [...task.dependsOn] });
