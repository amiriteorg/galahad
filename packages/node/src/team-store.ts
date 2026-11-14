import { Database } from "bun:sqlite";
import { chmodSync, closeSync, existsSync, openSync } from "node:fs";
import { findSecrets, randomId, readAlike, redact } from "@galahad/core";
import { defaultAvatar, resolveAvatar, type AvatarActivity } from "@galahad/core/avatar";
import { z } from "zod";
import {
  TEAM_GALAHAD, TEAM_LIMITS, TEAM_OWNER, TeammateInput, TeamRecruitInput, TeamRoomInput, TeamPostInput, TeamSayInput, TeamTaskInput, TeamWorkspace,
  type Teammate, type TeamRoom, type TeamMessage, type TeamTask, type TeamDelivery, type TeamSnapshot, type TeamRoomView, type TeamWorkStatus, type TeamOverview,
} from "../../core/src/team.ts";

export class TeamError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function teamInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new TeamError(400, result.error.issues[0]?.message ?? "Invalid team request");
  return result.data;
}

/** Caller-supplied chat and memory must never be kept with a credential in them. */
export function teamText(text: string): void {
  if (findSecrets(text).length) throw new TeamError(422, "This looks like a credential. Put it in the vault, not team chat or memory.");
}

/** Model output and failures are untrusted too; callers never persist their raw values. */
export function teamOutput(text: string, max: number = TEAM_LIMITS.output): string {
  const safe = redact(String(text)).slice(0, max);
  return findSecrets(safe).length ? "[Output withheld because it looks like a credential.]" : safe;
}

interface DocRow { value: string }
interface MessageRow { id: string; room: string; speaker: string; speaker_name: string; text: string; created_at: number; chain_id: string }
interface JobRow { id: string; kind: "delivery" | "task"; room: string; teammate: string; chain_id: string; status: TeamWorkStatus; data: string; error: string | null; created_at: number; updated_at: number }
export interface TeamJob { id: string; kind: "delivery" | "task"; room: string; teammate: string; chainId: string; status: TeamWorkStatus; createdAt: number }
export interface TeamSelection { room?: string; teammate?: string; task?: string }

const messageOf = (r: MessageRow): TeamMessage => ({ id: r.id, room: r.room, speaker: r.speaker, speakerName: r.speaker_name, text: r.text, createdAt: r.created_at, chainId: r.chain_id });
const jobOf = (r: JobRow): TeamJob => ({ id: r.id, kind: r.kind, room: r.room, teammate: r.teammate, chainId: r.chain_id, status: r.status, createdAt: r.created_at });
const id = (prefix: string): string => `${prefix}-${randomId(9).toLowerCase()}`;
/** A new worker's daily allowance, whoever makes it: yours to change. */
const DAILY_TURNS = 40;
const DAY = 24 * 3_600_000;
/** What Galahad is told of a room when he asks: its latest messages, each clipped; and of a worker's job, its start. */
const OVERVIEW = { messages: 20, message: 1200, job: 300 } as const;
const clipped = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters)` : text);
/** Why work stopped when its worker is gone, and why a direct conversation with a removed worker takes nothing new. */
const REMOVED = "Its squire was removed.";
const CLOSED = "This conversation is kept to read: its squire was removed.";
const matches = (job: TeamJob, select: TeamSelection) => (!select.room || job.room === select.room) && (!select.teammate || job.teammate === select.teammate) && (!select.task || job.id === select.task);

/** Additive, private, node-local state. Opening the store never touches chat history or the mind. */
export class TeamStore {
  private readonly db: Database;

  constructor(path: string, readonly now: () => number = Date.now) {
    if (path !== ":memory:") {
      if (!existsSync(path)) closeSync(openSync(path, "wx", 0o600));
      chmodSync(path, 0o600);
    }
    this.db = new Database(path);
    this.db.exec(`PRAGMA secure_delete = ON; PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS team_teammates (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS team_rooms (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS team_chains (id TEXT PRIMARY KEY, budget INTEGER NOT NULL, spent INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS team_usage (teammate TEXT NOT NULL, day TEXT NOT NULL, turns INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(teammate, day));
      CREATE TABLE IF NOT EXISTS team_messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, room TEXT NOT NULL REFERENCES team_rooms(id),
        speaker TEXT NOT NULL, speaker_name TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, chain_id TEXT NOT NULL REFERENCES team_chains(id));
      CREATE INDEX IF NOT EXISTS team_messages_room ON team_messages(room, seq);
      CREATE INDEX IF NOT EXISTS team_messages_speaker ON team_messages(speaker, created_at);
      CREATE TABLE IF NOT EXISTS team_jobs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, room TEXT NOT NULL REFERENCES team_rooms(id),
        teammate TEXT NOT NULL REFERENCES team_teammates(id), chain_id TEXT NOT NULL REFERENCES team_chains(id), status TEXT NOT NULL,
        data TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS team_jobs_queue ON team_jobs(status, seq);
      CREATE INDEX IF NOT EXISTS team_jobs_teammate ON team_jobs(teammate, status);
      CREATE INDEX IF NOT EXISTS team_jobs_activity ON team_jobs(updated_at, teammate, kind, status);
      CREATE TABLE IF NOT EXISTS team_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }

  close(): void { this.db.close(); }
  private day(): string { return new Date(this.now()).toISOString().slice(0, 10); }
  private turns(teammate: string): number { return this.db.query<{ turns: number }, [string, string]>("SELECT turns FROM team_usage WHERE teammate = ? AND day = ?").get(teammate, this.day())?.turns ?? 0; }
  /** The VMs' notes store (Engram) for this node's squires: off until you turn it on, and kept across restarts. */
  engram(): boolean { return this.db.query<DocRow, []>("SELECT value FROM team_settings WHERE key='engram'").get()?.value === "on"; }
  setEngram(raw: boolean): boolean {
    const on = teamInput(z.boolean(), raw);
    this.db.query("INSERT INTO team_settings(key,value) VALUES('engram',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(on ? "on" : "off");
    return on;
  }
  /** A worker's record as it is kept, whether or not it was removed. */
  private record(id: string): Teammate | null {
    const row = this.db.query<DocRow, [string]>("SELECT value FROM team_teammates WHERE id = ?").get(id);
    if (!row) return null;
    const value = JSON.parse(row.value) as Teammate;
    return { ...value, avatar: resolveAvatar(id, value.avatar), repository: value.repository ?? null, workspaceNode: value.workspaceNode ?? value.workspace?.node ?? null, createdBy: value.createdBy ?? TEAM_OWNER, instructionsBy: value.instructionsBy ?? TEAM_OWNER, turnsToday: this.turns(id) };
  }
  private records(): Teammate[] { return this.db.query<{ id: string }, []>("SELECT id FROM team_teammates ORDER BY id").all().map((r) => this.record(r.id)!); }
  /** A worker that is here. One that was removed is nobody's to work with, write to or change (null), though its record is kept. */
  teammate(id: string): Teammate | null {
    const kept = this.record(id);
    return kept && kept.removedAt === undefined ? kept : null;
  }
  teammates(): Teammate[] { return this.records().filter((t) => t.removedAt === undefined); }
  /** The workers you removed. Their handles stay taken and their names stay beside what they said. */
  removed(): Teammate[] { return this.records().filter((t) => t.removedAt !== undefined); }
  private putTeammate(value: Teammate): Teammate {
    this.db.query("INSERT INTO team_teammates(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(value.id, JSON.stringify(value));
    return this.teammate(value.id)!;
  }
  saveTeammate(raw: TeammateInput): Teammate {
    const input = teamInput(TeammateInput, raw);
    teamText([input.name, input.instructions, input.role, input.repository].filter(Boolean).join("\n"));
    if (this.record(input.id)?.removedAt !== undefined) throw new TeamError(409, "That handle belonged to a squire that was removed. Its history stays its own: choose another handle.");
    const previous = this.teammate(input.id);
    if (previous?.workspace && input.repository !== undefined && input.repository !== previous.repository) throw new TeamError(409, "This squire's workspace is already bound to its repository. Keep that repository to preserve its work.");
    if (!previous && this.teammates().length >= TEAM_LIMITS.teammates) throw new TeamError(409, `At most ${TEAM_LIMITS.teammates} squires can live on this node.`);
    const at = this.now();
    // This is your own way in: instructions you change here are yours from then on, whoever wrote the ones before.
    // (Saved as they were, with something else about the worker, they stay whose they were: the app sends them every time.)
    return this.putTeammate({ id: input.id, name: input.name, instructions: input.instructions ?? previous?.instructions ?? "", role: input.role ?? previous?.role ?? "engineer", harness: input.harness ?? previous?.harness ?? "native", enabled: input.enabled ?? previous?.enabled ?? true, dailyTurns: input.dailyTurns ?? previous?.dailyTurns ?? DAILY_TURNS, repository: input.repository === undefined ? previous?.repository ?? null : input.repository, turnsToday: this.turns(input.id), workspaceNode: previous?.workspaceNode ?? null, workspace: previous?.workspace ?? null, memory: previous?.memory ?? "", avatar: input.avatar === undefined ? previous?.avatar ?? defaultAvatar(input.id) : input.avatar ?? defaultAvatar(input.id), createdBy: previous?.createdBy ?? TEAM_OWNER, instructionsBy: input.instructions === undefined || input.instructions === previous?.instructions ? previous?.instructionsBy ?? TEAM_OWNER : TEAM_OWNER, createdAt: previous?.createdAt ?? at, updatedAt: at });
  }
  /** How many more workers Galahad may make for himself: on this node in all, and in the day now ending. */
  private spare(all: Teammate[] = this.teammates()): TeamOverview["spare"] {
    const since = this.now() - DAY;
    // One you removed still counts as made today: removing a worker gives him no more to make. It no longer takes a place on the node.
    const today = [...all, ...this.removed()].filter((t) => t.createdBy !== TEAM_OWNER && t.createdAt > since).length;
    return { workers: Math.max(0, TEAM_LIMITS.teammates - all.length), today: Math.max(0, TEAM_LIMITS.recruitsPerDay - today) };
  }
  /**
   * A worker Galahad makes for himself (`by`: TEAM_GALAHAD, or the worker that asked for it): only ever a new one,
   * with the defaults that stay yours to change, its job marked as his words and never yours, and within his
   * allowance for the day. `room`: its maker's room, which it joins at once unless that is a direct conversation.
   */
  recruit(raw: TeamRecruitInput, by: string, room?: string): Teammate {
    const input = teamInput(TeamRecruitInput, raw);
    teamText([input.name, input.instructions, input.role].filter(Boolean).join("\n"));
    return this.db.transaction(() => {
      if (by !== TEAM_GALAHAD) this.requireTeammate(by);
      const taken = this.record(input.id);
      if (taken?.removedAt !== undefined) throw new TeamError(409, `The handle ${input.id} belonged to a squire that was removed. Its history stays its own: choose another handle.`);
      if (taken) throw new TeamError(409, `A squire with the handle ${input.id} already exists. Work with them, or choose another handle.`);
      // A name a model chose must not be taken for another worker's, however it is spelled: one that was removed too, whose name is still beside what it said.
      const twin = this.records().find((other) => readAlike(other.name, input.name));
      if (twin) throw new TeamError(409, `The name ${input.name} reads like ${twin.name}'s (${twin.id}). Choose a name nobody could take for another squire's.`);
      const spare = this.spare();
      if (!spare.workers) throw new TeamError(409, `At most ${TEAM_LIMITS.teammates} squires can live on this node.`);
      if (!spare.today) throw new TeamError(429, `Galahad has made ${TEAM_LIMITS.recruitsPerDay} squires in the last day, which is his allowance. The owner can add more in Squires.`);
      const joined = room ? this.requireRoom(room) : null;
      // A worker brings one only into a room of its own.
      if (joined && by !== TEAM_GALAHAD) this.roomMember(joined, by);
      const at = this.now();
      const made = this.putTeammate({ id: input.id, name: input.name, instructions: input.instructions, role: input.role ?? "engineer", harness: "native", enabled: true, dailyTurns: DAILY_TURNS, repository: null, turnsToday: 0, workspaceNode: null, workspace: null, memory: "", avatar: defaultAvatar(input.id), createdBy: by, instructionsBy: by, createdAt: at, updatedAt: at });
      if (joined && !joined.direct) this.putRoom({ ...joined, members: [...joined.members, made.id], updatedAt: at });
      return made;
    })();
  }
  planWorkspace(teammate: string, raw: string): Teammate {
    const current = this.requireTeammate(teammate);
    const node = teamInput(z.string().min(1).max(200), raw);
    teamText(node);
    if (current.workspaceNode && current.workspaceNode !== node) throw new TeamError(409, "This squire's workspace is already assigned to another host.");
    return this.putTeammate({ ...current, workspaceNode: node, updatedAt: this.now() });
  }
  setWorkspace(teammate: string, raw: TeamWorkspace | null): Teammate {
    const current = this.requireTeammate(teammate);
    const workspace = raw === null ? null : teamInput(TeamWorkspace, raw);
    if (workspace) teamText(workspace.node);
    if (workspace && current.workspace && (current.workspace.node !== workspace.node || current.workspace.id !== workspace.id)) throw new TeamError(409, "This squire already has a workspace. Recover that workspace rather than replacing its work.");
    if (workspace && current.workspaceNode && current.workspaceNode !== workspace.node) throw new TeamError(409, "This squire's workspace is already assigned to another host.");
    if (workspace && this.teammates().some((t) => t.id !== teammate && t.workspace?.node === workspace.node && t.workspace?.id === workspace.id)) throw new TeamError(409, "That workspace belongs to another squire.");
    return this.putTeammate({ ...current, workspace, workspaceNode: workspace?.node ?? current.workspaceNode, updatedAt: this.now() });
  }
  remember(teammate: string, raw: string): Teammate {
    const memory = teamInput(z.string().max(TEAM_LIMITS.memory), raw);
    teamText(memory);
    return this.putTeammate({ ...this.requireTeammate(teammate), memory, updatedAt: this.now() });
  }
  requireTeammate(id: string): Teammate {
    const teammate = this.record(id);
    if (!teammate) throw new TeamError(404, "No such squire.");
    if (teammate.removedAt !== undefined) throw new TeamError(410, "That squire was removed.");
    return teammate;
  }
  /**
   * Retire a worker for good. Nothing of it is erased: its record is kept (so its handle is never anyone else's and
   * nothing new inherits its history), its words stay where it said them, and its direct conversations stay to read.
   * It leaves every shared room, and what it had not started is stopped. A bound workspace and running work are
   * the caller's to deal with first: neither is ever left behind.
   */
  remove(id: string): Teammate {
    return this.db.transaction(() => {
      const current = this.requireTeammate(id);
      if (current.workspace) throw new TeamError(409, "This squire still has a workspace. Destroy it with the squire, or keep the squire paused instead.");
      if (this.db.query("SELECT id FROM team_jobs WHERE teammate=? AND status='running'").get(id)) throw new TeamError(409, "Stop this squire's work before removing it.");
      const at = this.now();
      // Its direct conversations are closed with it: what its peers had still to say there is stopped too.
      const closing = new Set(this.rooms().filter((room) => room.direct && room.members.includes(id)).map((room) => room.id));
      for (const job of this.queued()) {
        if (job.teammate === id) this.finish(job.id, "stopped", REMOVED);
        else if (closing.has(job.room)) this.finish(job.id, "stopped", CLOSED);
      }
      for (const room of this.rooms()) if (!room.direct && room.members.includes(id)) this.putRoom({ ...room, members: room.members.filter((member) => member !== id), updatedAt: at });
      this.db.query("UPDATE team_teammates SET value=? WHERE id=?").run(JSON.stringify({ ...current, enabled: false, removedAt: at, updatedAt: at }), id);
      return this.record(id)!;
    })();
  }
  room(id: string): TeamRoom | null {
    const row = this.db.query<DocRow, [string]>("SELECT value FROM team_rooms WHERE id = ?").get(id);
    return row ? JSON.parse(row.value) as TeamRoom : null;
  }
  rooms(): TeamRoom[] { return this.db.query<DocRow, []>("SELECT value FROM team_rooms ORDER BY id").all().map((r) => JSON.parse(r.value) as TeamRoom); }
  /** A direct conversation with a worker that was removed: kept to read (by its id), and taking no new words or work. */
  private closed(room: TeamRoom): boolean { return room.direct && room.members.some((member) => !this.teammate(member)); }
  /** The rooms that are still in use. */
  private openRooms(): TeamRoom[] { return this.rooms().filter((room) => !this.closed(room)); }
  requireRoom(id: string): TeamRoom {
    const room = this.room(id);
    if (!room) throw new TeamError(404, "No such team room.");
    return room;
  }
  private putRoom(room: TeamRoom): TeamRoom {
    this.db.query("INSERT INTO team_rooms(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(room.id, JSON.stringify(room));
    return room;
  }
  saveRoom(raw: TeamRoomInput): TeamRoom {
    const input = teamInput(TeamRoomInput, raw);
    teamText(input.name);
    for (const member of input.members) this.requireTeammate(member);
    const previous = input.id ? this.room(input.id) : null;
    const direct = input.direct ?? previous?.direct ?? false;
    if (direct && input.members.length > 2) throw new TeamError(400, "A direct conversation has one or two squires.");
    if (previous?.direct && (direct !== true || [...previous.members].sort().join() !== [...input.members].sort().join())) throw new TeamError(409, "The people in a direct conversation cannot be changed.");
    if (!previous && this.rooms().length >= TEAM_LIMITS.rooms) throw new TeamError(409, `At most ${TEAM_LIMITS.rooms} team rooms can live on this node.`);
    const at = this.now();
    const saved = this.putRoom({ id: input.id ?? id("room"), name: input.name, members: input.members, direct, turnBudget: input.turnBudget ?? previous?.turnBudget ?? 8, paused: previous?.paused ?? false, createdAt: previous?.createdAt ?? at, updatedAt: at });
    // Membership is checked again when work starts; removed participants never see new history.
    return saved;
  }
  direct(teammate: string, from?: string): TeamRoom {
    const target = this.requireTeammate(teammate);
    if (from) this.requireTeammate(from);
    if (from === teammate) throw new TeamError(400, "A squire cannot send a direct message to itself.");
    const members = from ? [from, teammate].sort() : [teammate];
    const existing = this.rooms().find((r) => r.direct && [...r.members].sort().join() === members.join());
    return existing ?? this.saveRoom({ name: from ? `${this.requireTeammate(from).name} & ${target.name}`.slice(0, 100) : target.name, members, direct: true });
  }
  private chain(room: TeamRoom): string {
    const chain = id("chain");
    this.db.query("INSERT INTO team_chains(id,budget) VALUES(?,?)").run(chain, room.turnBudget);
    return chain;
  }
  private pending(): number { return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM team_jobs WHERE status IN ('queued','running')").get()!.n; }
  private roomMember(room: TeamRoom, teammate: string): void {
    this.requireTeammate(teammate);
    if (!room.members.includes(teammate)) throw new TeamError(403, "That squire is not a member of this room.");
  }
  /** Owner posts start a bounded chain, and so do Galahad's own from your conversation (`galahad`), within his
   * allowance for the day. Brokered posts keep their originating chain across rooms. */
  post(raw: TeamPostInput, by: { teammate?: string; chainId?: string; output?: boolean; galahad?: boolean } = {}): TeamMessage {
    const input = teamInput(TeamPostInput, raw);
    if (!by.output) teamText(input.text);
    return this.db.transaction(() => {
      const room = this.requireRoom(input.room);
      if (by.galahad && (by.teammate || by.chainId)) throw new TeamError(400, "Galahad speaks for himself, in a conversation of his own.");
      if (by.galahad && this.db.query<{ n: number }, [string, number]>("SELECT COUNT(*) AS n FROM team_messages WHERE speaker = ? AND created_at > ?").get(TEAM_GALAHAD, this.now() - DAY)!.n >= TEAM_LIMITS.saysPerDay) {
        throw new TeamError(429, `Galahad has sent ${TEAM_LIMITS.saysPerDay} messages into Squires in the last day, which is his allowance. The owner can message the squires in Squires.`);
      }
      if (by.teammate) this.roomMember(room, by.teammate);
      // (Only a direct conversation can still name a worker that was removed: it is kept to read, and takes no new words.)
      for (const member of room.members) this.requireTeammate(member);
      if (by.teammate && !by.chainId) throw new TeamError(403, "A squire message must belong to its current conversation.");
      if (by.chainId && !this.db.query("SELECT id FROM team_chains WHERE id = ?").get(by.chainId)) throw new TeamError(404, "No such conversation chain.");
      const recipients = room.members.filter((member) => member !== by.teammate);
      if (this.pending() + recipients.length > TEAM_LIMITS.pending) throw new TeamError(429, "The team queue is full. Let some work finish first.");
      // His own words never fill it: half is always left for yours, however much of his waits in held rooms.
      if (by.galahad && this.pending() + recipients.length > TEAM_LIMITS.pending / 2) throw new TeamError(429, "Half the team queue is waiting work already. Let some of it finish before writing to them again.");
      const chainId = by.chainId ?? this.chain(room);
      const at = this.now();
      const message: TeamMessage = { id: id("message"), room: room.id, speaker: by.teammate ?? (by.galahad ? TEAM_GALAHAD : TEAM_OWNER), speakerName: by.teammate ? this.requireTeammate(by.teammate).name : by.galahad ? "Galahad" : "You", text: by.output ? teamOutput(input.text, TEAM_LIMITS.message) : input.text, createdAt: at, chainId };
      this.db.query("INSERT INTO team_messages(id,room,speaker,speaker_name,text,created_at,chain_id) VALUES(?,?,?,?,?,?,?)").run(message.id, message.room, message.speaker, message.speakerName, message.text, at, chainId);
      for (const member of recipients) this.insertJob("delivery", room.id, member, chainId, { trigger: message.id });
      this.putRoom({ ...room, updatedAt: at });
      return message;
    })();
  }
  /** Galahad's own words to one worker (in the conversation you have with it) or to a room: all of it or nothing,
   * so a message that is refused leaves no conversation behind. */
  say(raw: TeamSayInput): TeamMessage {
    const input = teamInput(TeamSayInput, raw);
    return this.db.transaction(() => this.post({ room: input.room ?? this.direct(input.teammate!).id, text: input.text }, { galahad: true }))();
  }
  messages(room: string, limit: number = TEAM_LIMITS.history): TeamMessage[] {
    this.requireRoom(room);
    const count = Math.max(1, Math.min(TEAM_LIMITS.history, Math.trunc(limit) || TEAM_LIMITS.history));
    return this.db.query<MessageRow, [string, number]>("SELECT * FROM team_messages WHERE room = ? ORDER BY seq DESC LIMIT ?").all(room, count).reverse().map(messageOf);
  }
  private insertJob(kind: JobRow["kind"], room: string, teammate: string, chain: string, data: unknown): string {
    const key = id(kind === "task" ? "task" : "delivery");
    const at = this.now();
    this.db.query("INSERT INTO team_jobs(id,kind,room,teammate,chain_id,status,data,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?)").run(key, kind, room, teammate, chain, JSON.stringify(data), at, at);
    return key;
  }
  createTask(raw: TeamTaskInput, by: { teammate?: string; chainId?: string } = {}): TeamTask {
    const input = teamInput(TeamTaskInput, raw);
    teamText([input.title, input.goal, ...(input.gates ?? [])].join("\n"));
    return this.db.transaction(() => {
      const room = this.requireRoom(input.room);
      if (this.closed(room)) throw new TeamError(410, CLOSED);
      this.roomMember(room, input.assignee);
      if (by.teammate) this.roomMember(room, by.teammate);
      if (by.teammate && !by.chainId) throw new TeamError(403, "A delegated task must belong to the current conversation.");
      for (const dependency of input.dependsOn ?? []) {
        const task = this.task(dependency);
        if (!task || task.room !== room.id) throw new TeamError(400, "Every dependency must already exist in this room.");
      }
      if (this.pending() >= TEAM_LIMITS.pending) throw new TeamError(429, "The team queue is full. Let some work finish first.");
      const chain = by.chainId ?? this.chain(room);
      const key = this.insertJob("task", room.id, input.assignee, chain, { title: input.title, goal: input.goal, dependsOn: input.dependsOn ?? [], gates: input.gates ?? [], verified: false, progress: "", output: "" });
      return this.task(key)!;
    })();
  }
  private jobRow(id: string): JobRow | null { return this.db.query<JobRow, [string]>("SELECT * FROM team_jobs WHERE id = ?").get(id); }
  job(id: string): TeamJob | null { const row = this.jobRow(id); return row ? jobOf(row) : null; }
  private taskOf(row: JobRow): TeamTask {
    const data = JSON.parse(row.data) as Pick<TeamTask, "title" | "goal" | "dependsOn" | "gates" | "verified" | "progress" | "output">;
    return { ...data, id: row.id, room: row.room, assignee: row.teammate, chainId: row.chain_id, status: row.status, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  task(id: string): TeamTask | null { const row = this.jobRow(id); return row?.kind === "task" ? this.taskOf(row) : null; }
  /** Keep current work visible however much history accumulated while it ran. The active query
   * uses the status index; the history query walks recent sequence numbers, not a full-history sort. */
  private listedJobs(kind: JobRow["kind"], room?: string): JobRow[] {
    const active = room
      ? this.db.query<JobRow, [string, string]>("SELECT * FROM team_jobs WHERE kind=? AND room=? AND status IN ('running','queued') ORDER BY status='running' DESC,seq DESC LIMIT 512").all(kind, room)
      : this.db.query<JobRow, [string]>("SELECT * FROM team_jobs WHERE kind=? AND status IN ('running','queued') ORDER BY status='running' DESC,seq DESC LIMIT 512").all(kind);
    const remaining = 512 - active.length;
    if (remaining <= 0) return active;
    const recent = room
      ? this.db.query<JobRow, [string, string, number]>("SELECT * FROM team_jobs WHERE kind=? AND room=? AND status NOT IN ('running','queued') ORDER BY seq DESC LIMIT ?").all(kind, room, remaining)
      : this.db.query<JobRow, [string, number]>("SELECT * FROM team_jobs WHERE kind=? AND status NOT IN ('running','queued') ORDER BY seq DESC LIMIT ?").all(kind, remaining);
    return [...active, ...recent];
  }
  tasks(room?: string): TeamTask[] {
    return this.listedJobs("task", room).map((r) => this.taskOf(r));
  }
  deliveries(room?: string): TeamDelivery[] {
    return this.listedJobs("delivery", room).map((r) => ({ id: r.id, room: r.room, teammate: r.teammate, trigger: (JSON.parse(r.data) as { trigger: string }).trigger, chainId: r.chain_id, status: r.status, error: r.error, createdAt: r.created_at, updatedAt: r.updated_at }));
  }
  queued(): TeamJob[] { return this.db.query<JobRow, []>("SELECT * FROM team_jobs WHERE status='queued' ORDER BY seq").all().map(jobOf); }
  /** A bounded public activity projection: no titles, messages, errors or task JSON
   * leave the store with it. Keep old live jobs and only a minute of terminal states. */
  avatarActivity(): AvatarActivity {
    const rows = this.db.query<{ kind: JobRow["kind"]; teammate: string; status: TeamWorkStatus; updatedAt: number }, [number, number]>(`
      SELECT kind,teammate,status,MAX(updated_at) AS updatedAt FROM (
        SELECT kind,teammate,status,updated_at FROM team_jobs WHERE status IN ('running','queued')
        UNION ALL
        SELECT kind,teammate,status,updated_at FROM team_jobs WHERE updated_at >= ? AND status NOT IN ('running','queued')
      )
      GROUP BY teammate,kind,status
      ORDER BY status IN ('running','queued') DESC,updatedAt DESC LIMIT ?
    `).all(this.now() - 60_000, TEAM_LIMITS.teammates * 12);
    const tasks: AvatarActivity["tasks"][number][] = [];
    const deliveries: AvatarActivity["deliveries"][number][] = [];
    for (const row of rows) {
      // finish() only permits a task to reach done after a verified result.
      if (row.kind === "task") tasks.push({ assignee: row.teammate, status: row.status, verified: row.status === "done", updatedAt: row.updatedAt });
      else deliveries.push({ teammate: row.teammate, status: row.status, updatedAt: row.updatedAt });
    }
    return { tasks, deliveries };
  }
  snapshot(): TeamSnapshot {
    // Its kept conversations, yours with it first: they are in no other list.
    const direct = this.rooms().filter((room) => room.direct).sort((a, b) => a.members.length - b.members.length);
    const removed = this.removed().map(({ id, name, removedAt }) => { const conversations = direct.filter((room) => room.members.includes(id)).map((room) => room.id); return { id, name, removedAt, ...(conversations.length ? { conversations } : {}) }; });
    return { teammates: this.teammates(), rooms: this.openRooms(), tasks: this.tasks(), deliveries: this.deliveries(), ...(removed.length ? { removed } : {}), ...(this.engram() ? { engram: true } : {}) };
  }
  /** The team as Galahad himself reads it: bounded, and without anyone's working notes. `room`: that room's latest words too. */
  overview(room?: string): TeamOverview {
    const all = this.teammates();
    const active = this.db.query<{ teammate: string; status: TeamWorkStatus }, []>("SELECT teammate,status FROM team_jobs WHERE status IN ('running','queued')").all();
    const state = (t: Teammate): TeamOverview["workers"][number]["state"] =>
      active.some((job) => job.teammate === t.id && job.status === "running") ? "working" : !t.enabled ? "paused" : t.turnsToday >= t.dailyTurns ? "allowance spent" : active.some((job) => job.teammate === t.id) ? "queued" : "ready";
    const asked = room === undefined ? null : this.requireRoom(room);
    return {
      workers: all.map((t) => ({ id: t.id, name: t.name, role: t.role, harness: t.harness, job: clipped(t.instructions, OVERVIEW.job), madeBy: t.createdBy ?? TEAM_OWNER, state: state(t), turnsToday: t.turnsToday, dailyTurns: t.dailyTurns, repository: t.repository, workspace: Boolean(t.workspace) })),
      rooms: this.openRooms().map(({ id, name, members, direct, paused, turnBudget }) => ({ id, name, members, direct, paused, turnBudget })),
      ...(asked ? { room: {
        id: asked.id, name: asked.name, members: asked.members, direct: asked.direct, paused: asked.paused,
        messages: this.messages(asked.id, OVERVIEW.messages).map(({ speaker, speakerName, text, createdAt }) => ({ speaker, speakerName, text: clipped(text, OVERVIEW.message), createdAt })),
        tasks: this.tasks(asked.id).slice(0, 32).map(({ id, title, assignee, status, verified }) => ({ id, title, assignee, status, verified })),
      } } : {}),
      spare: this.spare(all),
    };
  }
  roomView(id: string): TeamRoomView { return { ...this.requireRoom(id), messages: this.messages(id), tasks: this.tasks(id), deliveries: this.deliveries(id) }; }

  /** Daily allowance and the cross-room causal allowance are reserved together, before any callback runs. */
  claim(key: string): boolean {
    return this.db.transaction(() => {
      const row = this.jobRow(key);
      if (!row || row.status !== "queued") return false;
      // (Never a throw here: one job that cannot run must not hold up everyone else's.)
      const teammate = this.teammate(row.teammate);
      if (!teammate) { this.finish(key, "stopped", REMOVED); return false; }
      const room = this.requireRoom(row.room);
      if (this.closed(room)) { this.finish(key, "stopped", CLOSED); return false; }
      if (!room.members.includes(teammate.id)) { this.finish(key, "stopped", "The squire is no longer in this room."); return false; }
      if (!teammate.enabled || room.paused) return false;
      if (this.db.query("SELECT id FROM team_jobs WHERE teammate=? AND status='running'").get(teammate.id)) return false;
      if (row.kind === "task") {
        const task = this.taskOf(row);
        if (!task.dependsOn.every((key) => { const before = this.task(key); return before?.status === "done" && before.verified; })) return false;
      }
      const chain = this.db.query<{ budget: number; spent: number }, [string]>("SELECT budget,spent FROM team_chains WHERE id=?").get(row.chain_id);
      if (!chain || chain.spent >= chain.budget) { this.finish(key, "stopped", "This conversation reached its turn budget. Start a new message to continue."); return false; }
      if (this.turns(teammate.id) >= teammate.dailyTurns) return false;
      this.db.query("INSERT INTO team_usage(teammate,day,turns) VALUES(?,?,1) ON CONFLICT(teammate,day) DO UPDATE SET turns=turns+1").run(teammate.id, this.day());
      this.db.query("UPDATE team_chains SET spent=spent+1 WHERE id=?").run(row.chain_id);
      this.db.query("UPDATE team_jobs SET status='running',error=NULL,updated_at=? WHERE id=? AND status='queued'").run(this.now(), key);
      return true;
    })();
  }
  progress(key: string, text: string): void {
    const row = this.jobRow(key);
    if (!row || row.kind !== "task" || row.status !== "running") return;
    const data = { ...JSON.parse(row.data), progress: teamOutput(text, TEAM_LIMITS.progress) };
    this.db.query("UPDATE team_jobs SET data=?,updated_at=? WHERE id=?").run(JSON.stringify(data), this.now(), key);
  }
  finish(key: string, status: Exclude<TeamWorkStatus, "queued" | "running">, error: string | null = null, result?: { verified: boolean; output: string }): void {
    const row = this.jobRow(key);
    if (!row || (row.status !== "queued" && row.status !== "running")) return;
    const data = JSON.parse(row.data);
    if (row.kind === "task") {
      data.verified = status === "done" && result?.verified === true;
      data.output = teamOutput(result?.output ?? data.output ?? "");
      if (status === "done" && !data.verified) { status = "failed"; error = error ?? "The work was not independently verified."; }
    }
    this.db.query("UPDATE team_jobs SET status=?,data=?,error=?,updated_at=? WHERE id=?").run(status, JSON.stringify(data), error ? teamOutput(error, 2000) : null, this.now(), key);
  }
  /** In-flight side effects are never replayed by merely reopening a node. */
  recover(): void {
    this.db.transaction(() => {
      const running = this.db.query<JobRow, []>("SELECT * FROM team_jobs WHERE status='running'").all();
      for (const row of running) {
        this.finish(row.id, "interrupted", "The node stopped during this work. Review it before resuming.");
        this.pauseRoom(row.room, true);
      }
    })();
  }
  pauseRoom(id: string, paused: boolean): TeamRoom { return this.putRoom({ ...this.requireRoom(id), paused, updatedAt: this.now() }); }
  enable(id: string, enabled: boolean): Teammate { return this.putTeammate({ ...this.requireTeammate(id), enabled, updatedAt: this.now() }); }
  stopQueued(select: TeamSelection): void {
    for (const job of this.queued()) if (matches(job, select)) this.finish(job.id, "stopped", "Stopped by you.");
  }
  /** Explicit owner resume is the only way interrupted or stopped work becomes runnable again. */
  resume(select: TeamSelection): void {
    this.db.transaction(() => {
      const found = this.db.query<JobRow, []>("SELECT * FROM team_jobs WHERE status IN ('interrupted','stopped','failed') ORDER BY seq").all().filter((r) => matches(jobOf(r), select) && (select.task || r.status === "interrupted"));
      // What a removed worker left unfinished is never started again: asked for by name it says so, otherwise it is passed over.
      const rows = found.filter((r) => this.teammate(r.teammate));
      if (select.task && found.length && !rows.length) throw new TeamError(410, "That task's squire was removed. Revise the task for another squire.");
      if (this.pending() + rows.length > TEAM_LIMITS.pending) throw new TeamError(429, "Too much work to resume at once.");
      const chains = new Map<string, string>();
      for (const row of rows) {
        let chain = chains.get(row.room);
        if (!chain) { chain = this.chain(this.requireRoom(row.room)); chains.set(row.room, chain); }
        this.db.query("UPDATE team_jobs SET status='queued',error=NULL,chain_id=?,updated_at=? WHERE id=?").run(chain, this.now(), row.id);
      }
    })();
  }
}
