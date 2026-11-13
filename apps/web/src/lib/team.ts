import type { TeamDelivery, TeamMessage, TeamSnapshot, TeamTask, Teammate } from "@galahad/core/team";

export type TeamTab = "chat" | "work" | "workspace";
export interface TeamLocation { room?: string; teamTab?: TeamTab }

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

export function teammateInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => [...word][0] ?? "").join("").toLocaleUpperCase() || "G";
}

/** A profile ID is stable after a rename; reserved speakers are never assigned. */
export function teammateId(name: string, taken: string[]): string {
  const cleaned = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = (/^[a-z]/.test(cleaned) ? cleaned : `teammate-${cleaned}`).slice(0, 28).replace(/-+$/, "") || "teammate";
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

/** Who made a worker, when it wasn't you: Galahad himself in your conversation with him, or one of his workers. */
export function teammateMaker(person: Pick<Teammate, "createdBy">, teammates: Teammate[]): string | null {
  if (!person.createdBy || person.createdBy === "owner") return null;
  return person.createdBy === "galahad" ? "Galahad" : (teammates.find((other) => other.id === person.createdBy)?.name ?? person.createdBy);
}

/** Historical attribution survives a profile rename or removal. */
export function teamSpeaker(message: Pick<TeamMessage, "speaker" | "speakerName">, teammates: Teammate[]): string {
  if (message.speaker === "owner") return "You";
  if (message.speaker === "galahad") return "Galahad";
  if (message.speaker === "system") return "Team activity";
  return message.speakerName || teammates.find((person) => person.id === message.speaker)?.name || message.speaker;
}

/** A queued task cannot run until every predecessor completed and passed its checks. */
export function taskDependencies(task: Pick<TeamTask, "dependsOn">, all: TeamTask[]): { id: string; title: string; satisfied: boolean }[] {
  return task.dependsOn.map((id) => {
    const parent = all.find((candidate) => candidate.id === id);
    return { id, title: parent?.title ?? id, satisfied: parent?.status === "done" && parent.verified };
  });
}
