import type { TeamDelivery, TeamEngramStatus, TeamHarness, TeamMessage, TeamSnapshot, TeamTask, Teammate } from "@galahad/core/team";

export type TeamTab = "chat" | "work" | "workspace";
export interface TeamLocation { room?: string; teamTab?: TeamTab }

/** A squire's coding harness, as it is named to you: his own, or a tool that does the engineer's part in the VM
 * (the vendors' own tools by their own names, in plain text). */
export const HARNESS: Record<TeamHarness, string> = { native: "Galahad", opencode: "OpenCode", hermes: "Hermes Agent", claude: "Claude Code", codex: "Codex" };

/** What the node found of one harness in a squire's VM: `on`, what it would run on there; `reason`, why it can't yet. */
export interface HarnessStatus { id: string; ready: boolean; on?: string; reason?: string }

/** The line under a harness's name: what to do so that it can work, or what it would run on. */
export const harnessNote = (harness: HarnessStatus): string | null => harness.reason ?? (harness.on ? `Runs on ${harness.on}` : null);

/**
 * The notes store (Engram) in a squire's Workspace, in a line: the node's switch, and whether this VM has the
 * pinned binary. A store that isn't in the VM is never called on for it. Null: the node says nothing of one.
 */
export function engramLine(status: TeamEngramStatus | undefined): { badge: string; tone: "ok" | "warn" | "neutral"; text: string } | null {
  if (!status) return null;
  const engram = `Engram ${status.pinned}`;
  if (!status.on) {
    const here = status.present === true ? ` ${engram} is in this VM, should you turn it on.` : status.present === false ? ` Turned on, it would not reach this squire: ${status.reason}.` : "";
    return { badge: "Off", tone: "neutral", text: `Off: tasks are given no notes store.${here}` };
  }
  if (status.present === true) return { badge: "On", tone: "ok", text: `${engram} is in this VM, and this squire's tasks are given it. Notes are a task's own leads, kept in this VM and checked before they are trusted.` };
  if (status.present === false) return { badge: "Not in this VM", tone: "warn", text: `On, but ${status.reason}. This squire's tasks run without it and say so.` };
  return { badge: "On", tone: "neutral", text: `On. Whether this VM has ${engram} is asked when the squire is idle and its VM is running.` };
}

/** Team addresses keep the room when the page is reloaded or shared. */
export function teamLocation(hash: string): TeamLocation {
  if (!/^#\/team(?:\?|$)/.test(hash)) return {};
  const params = new URLSearchParams(hash.split("?")[1] ?? "");
  const room = params.get("room");
  const tab = params.get("tab");
  return {
    ...(room && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(room) ? { room } : {}),
    ...(tab === "work" || tab === "workspace" ? { teamTab: tab } : {}),
  };
}

export function teamHash(location: TeamLocation): string {
  const params = new URLSearchParams();
  if (location.room) params.set("room", location.room);
  if (location.teamTab && location.teamTab !== "chat") params.set("tab", location.teamTab);
  return `#/team${params.size ? `?${params}` : ""}`;
}

/** The address the app settles on when it opens at a page: the page's own, and for Team its room and tab as well
 * (in teamHash's own form), so a reload or a link comes back to the same conversation. */
export const landingHash = (route: string, hash: string): string => (route === "team" ? teamHash(teamLocation(hash)) : `#/${route}`);

/** A handle as its form field checks it. A browser compiles a field's pattern with the v flag, where a hyphen
 * inside a class must be escaped: unescaped, the field is never checked at all. */
export const HANDLE_PATTERN = "[a-z][a-z0-9\\-]{0,31}";

export function teammateInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => [...word][0] ?? "").join("").toLocaleUpperCase() || "G";
}

/** A profile ID is stable after a rename; reserved speakers are never assigned. */
export function teammateId(name: string, taken: string[]): string {
  const cleaned = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = (/^[a-z]/.test(cleaned) ? cleaned : `squire-${cleaned}`).slice(0, 28).replace(/-+$/, "") || "squire";
  const used = new Set([...taken, "owner", "system", "galahad"]);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

export const activeTeamWork = (work: Pick<TeamTask | TeamDelivery, "status">): boolean => work.status === "queued" || work.status === "running";

export function teammateState(person: Teammate, snapshot: Pick<TeamSnapshot, "tasks" | "deliveries">): { text: string; tone: "neutral" | "warn" | "accent"; live: boolean } {
  const work = [...snapshot.tasks.filter((task) => task.assignee === person.id), ...snapshot.deliveries.filter((delivery) => delivery.teammate === person.id)];
  if (work.some((item) => item.status === "running")) return { text: "Working", tone: "accent", live: true };
  if (!person.enabled) return { text: "Paused", tone: "warn", live: false };
  if (person.turnsToday >= person.dailyTurns) return { text: "Daily limit reached", tone: "warn", live: false };
  if (work.some((item) => item.status === "queued")) return { text: "Queued", tone: "neutral", live: false };
  return { text: "Ready", tone: "neutral", live: false };
}

/** Who made a worker, when it wasn't you: Galahad himself in your conversation with him, or one of his workers
 * (named still when you have since removed that one). */
export function teammateMaker(person: Pick<Teammate, "createdBy">, teammates: Teammate[], removed: NonNullable<TeamSnapshot["removed"]> = []): string | null {
  if (!person.createdBy || person.createdBy === "owner") return null;
  const maker = [...teammates, ...removed].find((other) => other.id === person.createdBy);
  return person.createdBy === "galahad" ? "Galahad" : (maker?.name ?? person.createdBy);
}

/** Every handle that is spoken for: the workers here, and the ones you removed, whose handles are never used again. */
export const takenHandles = (snapshot: Pick<TeamSnapshot, "teammates" | "removed"> | null): string[] =>
  [...(snapshot?.teammates ?? []), ...(snapshot?.removed ?? [])].map((person) => person.id);

/** What removing a worker means, said before it is done: what goes, what stays, and whether this device may do it
 * (`blocked` says why not). A worker's VM goes with it, which takes a device that may manage sandboxes. */
export function removalPlan(person: Pick<Teammate, "id" | "name" | "workspace" | "workspaceNode">, may: { sandbox: boolean }): { blocked: string | null; lines: string[]; destroyWorkspace: boolean } {
  const lines = [
    `${person.name} leaves every room and does no more work. What ${person.name} said stays where it was said, and its direct conversations are kept.`,
    `The handle ${person.id} is never used again, so nothing new inherits its history.`,
  ];
  // A VM that was being made when the node last stopped may exist without ever having been bound: the node looks for itself.
  if (!person.workspace && !person.workspaceNode) return { blocked: null, lines: [...lines, "This can't be undone."], destroyWorkspace: false };
  if (!may.sandbox) return { blocked: `${person.name} has a VM, and removing ${person.name} destroys it. That takes a device that may manage sandboxes; this one may not.`, lines, destroyWorkspace: true };
  const vm = person.workspace ? `${person.name}'s VM is destroyed with it, and everything in its /work.` : `A VM was being made for ${person.name}: if there is one, it is destroyed with it, and everything in its /work.`;
  return { blocked: null, lines: [...lines, `${vm} This can't be undone.`], destroyWorkspace: true };
}

/** Historical attribution survives a profile rename or removal. */
export function teamSpeaker(message: Pick<TeamMessage, "speaker" | "speakerName">, teammates: Teammate[]): string {
  if (message.speaker === "owner") return "You";
  if (message.speaker === "galahad") return "Galahad";
  if (message.speaker === "system") return "Squires' activity";
  return message.speakerName || teammates.find((person) => person.id === message.speaker)?.name || message.speaker;
}

/** A queued task cannot run until every predecessor completed and passed its checks. */
export function taskDependencies(task: Pick<TeamTask, "dependsOn">, all: TeamTask[]): { id: string; title: string; satisfied: boolean }[] {
  return task.dependsOn.map((id) => {
    const parent = all.find((candidate) => candidate.id === id);
    return { id, title: parent?.title ?? id, satisfied: parent?.status === "done" && parent.verified };
  });
}
