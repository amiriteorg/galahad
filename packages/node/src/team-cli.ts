import type { RouteName, TeamSnapshot, TeamRoomView, TeamRoom, Teammate } from "@galahad/core";
import { resolveAvatar, withBodyColor } from "@galahad/core/avatar";

interface Api { call<T>(name: RouteName, input?: unknown): Promise<T> }
type Flags = Record<string, unknown>;
const usage = "galahad team [add <id> | avatar <id> | dm <id> [message] | room <name> <member…> | chat <room> [message] | task <room> <assignee> <goal> | provision <id> | memory <id> [text] | pause|resume|stop <room|teammate|task> <id>]";

export async function teamCommand(api: Api, sub: string | undefined, args: string[], flags: Flags, print: (s: string) => void = console.log): Promise<void> {
  const string = (key: string) => typeof flags[key] === "string" ? flags[key] as string : undefined;
  if (!sub || sub === "ls") {
    const state = await api.call<TeamSnapshot>("team");
    // (One Galahad made for himself says so: in your conversation with him, or by the worker that asked for it.)
    const maker = (m: Teammate) => (!m.createdBy || m.createdBy === "owner" ? "" : ` · made by ${m.createdBy === "galahad" ? "Galahad" : m.createdBy}`);
    for (const m of state.teammates) print(`${m.id} · ${m.name} · ${m.harness} · ${m.enabled ? "enabled" : "paused"} · ${m.turnsToday}/${m.dailyTurns} turns today · ${m.workspace ? `VM ${m.workspace.id} on ${m.workspace.node}` : "VM not provisioned"}${maker(m)}`);
    for (const r of state.rooms) print(`${r.id} · ${r.name} · ${r.members.join(", ")}${r.paused ? " · paused" : ""}`);
    for (const t of state.tasks) print(`${t.id} · ${t.status}${t.verified ? " (verified)" : ""} · ${t.assignee} · ${t.title}`);
    if (!state.teammates.length) print("Create a teammate with galahad team add <id> --name <name>, or open Team in the app.");
    return;
  }
  if (sub === "add") {
    const id = args[0];
    const result = await api.call<{ teammate: Teammate }>("saveTeammate", { id, name: string("name") ?? id, ...(string("instructions") ? { instructions: string("instructions") } : {}), ...(string("role") ? { role: string("role") } : {}), ...(string("agent") ? { harness: string("agent") } : {}), ...(string("repo") ? { repository: string("repo") } : {}), ...(string("limit") ? { dailyTurns: Number(string("limit")) } : {}) });
    print(`${result.teammate.name} is ready to chat. VM work is provisioned on a KVM/Kata host when first needed.`); return;
  }
  if (sub === "avatar") {
    const state = await api.call<TeamSnapshot>("team");
    const member = state.teammates.find((m) => m.id === args[0]);
    if (!member) throw new Error("No such teammate");
    const fields = ["form", "accent", "eyes", "accessory", "temperament"] as const;
    const changes = Object.fromEntries(fields.flatMap((key) => string(key) !== undefined ? [[key, string(key)]] : []));
    const color = string("color");
    if (flags.reset || color !== undefined || Object.keys(changes).length) {
      // A new body color brings its matching accent, unless an accent is named too (or was chosen apart before).
      const current = resolveAvatar(member.id, member.avatar);
      const { teammate } = await api.call<{ teammate: Teammate }>("saveTeammate", { id: member.id, name: member.name, avatar: flags.reset ? null : { ...(color === undefined ? current : withBodyColor(current, color)), ...changes } });
      print(JSON.stringify(resolveAvatar(teammate.id, teammate.avatar), null, 2));
    } else print(JSON.stringify(resolveAvatar(member.id, member.avatar), null, 2));
    return;
  }
  if (sub === "room") {
    const { room } = await api.call<{ room: TeamRoom }>("saveTeamRoom", { name: args[0], members: args.slice(1), ...(string("limit") ? { turnBudget: Number(string("limit")) } : {}) });
    print(`${room.id} · ${room.name}`); return;
  }
  if (sub === "dm" || sub === "chat") {
    const room = sub === "dm" ? (await api.call<{ room: TeamRoom }>("directTeammate", { id: args[0] })).room.id : args[0];
    const text = args.slice(1).join(" ");
    if (text) { await api.call("postTeamMessage", { room, text }); print(`Sent to ${room}; replies continue on the node. Read with galahad team chat ${room}.`); }
    else { const view = await api.call<TeamRoomView>("teamRoom", { id: room }); for (const m of view.messages) print(`${m.speakerName}: ${m.text}`); }
    return;
  }
  if (sub === "task") {
    const goal = args.slice(2).join(" ");
    const gates = typeof flags.gate === "string" ? [flags.gate] : Array.isArray(flags.gate) ? flags.gate : [];
    const { task } = await api.call<{ task: { id: string } }>("createTeamTask", { room: args[0], assignee: args[1], title: string("title") ?? goal.slice(0, 200), goal, gates, ...(string("after") ? { dependsOn: string("after")!.split(",") } : {}) });
    print(`${task.id} queued; completion requires its gates and independent review.`); return;
  }
  if (sub === "provision") {
    const result = await api.call<{ workspace: { id: string; node: string } }>("provisionTeammate", { id: args[0], ...(string("on") ? { on: string("on") } : {}), ...(string("cpus") ? { cpus: Number(string("cpus")) } : {}), ...(string("mem") ? { memoryGb: Number(string("mem")) } : {}), ...(string("disk") ? { diskGb: Number(string("disk")) } : {}) });
    print(`VM ${result.workspace.id} on ${result.workspace.node}`); return;
  }
  if (sub === "memory") {
    if (args.length > 1) await api.call("teamMemory", { id: args[0], text: args.slice(1).join(" ") });
    const state = await api.call<TeamSnapshot>("team");
    const m = state.teammates.find((m) => m.id === args[0]); if (!m) throw new Error("No such teammate"); print(m.memory || "No notes yet."); return;
  }
  if (["pause", "resume", "stop"].includes(sub) && ["room", "teammate", "task"].includes(args[0] ?? "")) {
    await api.call("controlTeam", { action: sub, [args[0]!]: args[1] }); print(`${sub}: ${args[0]} ${args[1]}`); return;
  }
  throw new Error(usage);
}
