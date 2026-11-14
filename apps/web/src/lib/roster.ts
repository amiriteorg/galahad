import { avatarExpression, type AvatarExpression } from "@galahad/core/avatar";
import type { TeamDelivery, TeamMessage, TeamRoom, TeamSnapshot, TeamTask, Teammate } from "@galahad/core/team";
import { taskDependencies, teammateMaker, teamSpeaker } from "./team.ts";

/*
 * The roster: the app's home. Galahad first (his line is lib/now.ts), then each knight, then
 * each room, every row with one line of latest activity and a mark when it needs you. Pure
 * (no DOM), and worked out from what the app already asks the node: the team as one snapshot,
 * the approvals waiting in the Inbox, and the last thing said in a conversation where the app
 * has read it. Nothing is asked for per row.
 */

/** The last thing said in a conversation, as the app last read it there. */
export type Said = Pick<TeamMessage, "speaker" | "speakerName" | "text" | "createdAt">;
/** An approval waiting for your answer: who asked, and for what. */
export interface Ask { by: string; connector?: string; tool?: string }

export interface RosterInput {
  snapshot: Pick<TeamSnapshot, "teammates" | "rooms" | "tasks" | "deliveries" | "removed">;
  /** By conversation. The app reads a conversation's words only when it is opened, so most have none. */
  said?: ReadonlyMap<string, Said>;
  asks?: readonly Ask[];
  now: number;
}

export interface RosterRow {
  key: string;
  kind: "knight" | "room";
  /** A knight's handle, or a room's id. */
  id: string;
  name: string;
  /** The conversation the row opens (a knight you have not written to yet has none). */
  room: string | null;
  line: string;
  /** Only you can move this on: a failure to read, an approval to give, work waiting on a pause. */
  needs: boolean;
  /** A knight's face, as its work stands (core's avatarExpression). */
  expression?: AvatarExpression;
  avatar?: unknown;
}

/** The knight that filed an approval ("arm:team.<controller>.<handle>"), or null when someone else asked. */
export const knightOfCaller = (by: string): string | null => /^arm:team\.[a-f0-9]{10}\.([a-z][a-z0-9-]{0,31})$/.exec(by)?.[1] ?? null;

/** What waits for you that is no knight's: the Inbox's count, less the approvals that show on a knight's own row. */
export const galahadNeeds = (inbox: number, asks: readonly Pick<Ask, "by">[], knights: readonly string[]): number =>
  Math.max(0, inbox - asks.filter((ask) => knights.includes(knightOfCaller(ask.by) ?? "")).length);

type Job = (TeamTask & { task: true }) | (TeamDelivery & { task?: undefined });
const firstLine = (text: string | null | undefined): string => (text ?? "").trim().split("\n")[0]?.trim() ?? "";
const titled = (task: Pick<TeamTask, "title">): string => `“${task.title}”`;
const withWhy = (line: string, why: string | null): string => (firstLine(why) ? `${line} · ${firstLine(why)}` : line);
const latestOf = (jobs: Job[]): Job | undefined => jobs.reduce<Job | undefined>((latest, job) => (!latest || job.updatedAt > latest.updatedAt ? job : latest), undefined);
const waitingIn = (jobs: Job[]): number => jobs.filter((job) => job.status === "queued").length;

/** Work that went wrong and waits to be read, in a line (null: it didn't, or it was a stop of your own). */
function trouble(job: Job | undefined, who: string | null): string | null {
  if (!job || (job.status !== "failed" && job.status !== "interrupted")) return null;
  if (job.status === "interrupted") return `Interrupted: ${job.task ? titled(job) : `${who ? `${who}'s` : "a"} reply`} · review it before resuming`;
  return job.task ? withWhy(`Failed: ${titled(job)}`, job.error) : withWhy(who ? `${who} couldn't reply` : "Couldn't reply", job.error);
}

/** How a task ended, when that is the latest thing to say. */
function ended(task: TeamTask): string {
  if (task.status === "stopped") return `Stopped: ${titled(task)}`;
  const kept = task.changes ? ` · ${task.changes.files} file${task.changes.files === 1 ? "" : "s"} kept` : "";
  return `${task.verified ? "Verified" : "Done"}: ${titled(task)}${kept}`;
}

/** The last thing said in a conversation, if the app's reading of it is still the latest (the room hasn't moved since). */
function lastSaid(room: TeamRoom | undefined, input: RosterInput): Said | null {
  const said = room ? input.said?.get(room.id) : undefined;
  return said && room!.updatedAt <= said.createdAt ? said : null;
}
const saidLine = (said: Said, teammates: Teammate[]): string => `${teamSpeaker(said, teammates)}: ${firstLine(said.text)}`;

function knightRow(person: Teammate, input: RosterInput): RosterRow {
  const { snapshot } = input;
  const room = snapshot.rooms.find((candidate) => candidate.direct && candidate.members.length === 1 && candidate.members[0] === person.id);
  const jobs: Job[] = [...snapshot.tasks.filter((task) => task.assignee === person.id).map((task) => ({ ...task, task: true as const })), ...snapshot.deliveries.filter((delivery) => delivery.teammate === person.id)];
  const asked = (input.asks ?? []).filter((ask) => knightOfCaller(ask.by) === person.id);
  const say = (line: string, needs = false): RosterRow => ({ key: `person:${person.id}`, kind: "knight", id: person.id, name: person.name, room: room?.id ?? null, line, needs, expression: avatarExpression(person, snapshot, input.now), avatar: person.avatar });

  // What only you can answer comes first: it is what the row is marked for.
  if (asked[0]) return say(`Asks your leave: ${asked[0].connector}.${asked[0].tool}${asked.length > 1 ? `, and ${asked.length - 1} more` : ""}`, true);
  const running = jobs.find((job) => job.status === "running" && job.task);
  if (running?.task) return say(firstLine(running.progress) ? `${running.title} · ${firstLine(running.progress)}` : `Working on ${titled(running)}`);
  if (jobs.some((job) => job.status === "running")) return say("Writing a reply");
  const latest = latestOf(jobs);
  const wrong = trouble(latest, null);
  if (wrong) return say(wrong, true);
  const waiting = waitingIn(jobs);
  const held = !person.enabled ? "Paused" : person.turnsToday >= person.dailyTurns ? "Daily allowance spent" : null;
  if (held) return say(waiting ? `${held} · ${waiting} waiting` : held, waiting > 0);
  const queued = jobs.find((job) => job.status === "queued" && job.task);
  if (queued?.task) {
    const blocking = taskDependencies(queued, snapshot.tasks).find((dependency) => !dependency.satisfied);
    return say(blocking ? `Waiting for “${blocking.title}”` : `Queued: ${titled(queued)}`);
  }
  if (waiting) return say("Reply queued");
  const task = latestOf(jobs.filter((job) => job.task));
  const said = lastSaid(room, input);
  if (said && (!task || said.createdAt >= task.updatedAt)) return say(saidLine(said, snapshot.teammates));
  if (task?.task) return say(ended(task));
  const job = firstLine(person.instructions) || person.role;
  const maker = teammateMaker(person, snapshot.teammates, snapshot.removed);
  return say(maker ? `Made by ${maker} · ${job}` : job);
}

function roomRow(room: TeamRoom, input: RosterInput): RosterRow {
  const { snapshot } = input;
  const nameOf = (id: string): string => snapshot.teammates.find((person) => person.id === id)?.name ?? id;
  const jobs: Job[] = [...snapshot.tasks.filter((task) => task.room === room.id).map((task) => ({ ...task, task: true as const })), ...snapshot.deliveries.filter((delivery) => delivery.room === room.id)];
  const say = (line: string, needs = false): RosterRow => ({ key: `room:${room.id}`, kind: "room", id: room.id, name: room.name, room: room.id, line, needs });

  const working = jobs.filter((job) => job.status === "running" && job.task) as (TeamTask & { task: true })[];
  if (working[0]) return say(`${working.length > 1 ? `${working.length} at work` : nameOf(working[0].assignee)} · ${working[0].title}`);
  const writing = jobs.filter((job) => job.status === "running" && !job.task) as TeamDelivery[];
  if (writing.length) return say(`${writing.map((delivery) => nameOf(delivery.teammate)).join(", ")} ${writing.length > 1 ? "are" : "is"} writing`);
  const latest = latestOf(jobs);
  const wrong = trouble(latest, latest && !latest.task ? nameOf(latest.teammate) : null);
  if (wrong) return say(wrong, true);
  const waiting = waitingIn(jobs);
  if (room.paused) return say(waiting ? `Paused · ${waiting} waiting` : "Paused", waiting > 0);
  const said = lastSaid(room, input);
  return say(said ? saidLine(said, snapshot.teammates) : room.members.map(nameOf).join(", "));
}

/** Every row after Galahad's: the knights as the node lists them, then the rooms, the latest spoken in first. */
export function rosterRows(input: RosterInput): RosterRow[] {
  const rooms = input.snapshot.rooms.filter((room) => !room.direct).sort((a, b) => b.updatedAt - a.updatedAt);
  return [...input.snapshot.teammates.map((person) => knightRow(person, input)), ...rooms.map((room) => roomRow(room, input))];
}
