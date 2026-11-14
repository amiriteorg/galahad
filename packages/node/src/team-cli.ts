import { plainLine, plainText, type Prices, type RouteName, taskRecordFacts, type TeamSnapshot, type TeamRoomView, type TeamRoom, type TeamTask, type Teammate } from "@galahad/core";
import { resolveAvatar, withBodyColor } from "@galahad/core/avatar";

interface Api { call<T>(name: RouteName, input?: unknown): Promise<T> }
type Flags = Record<string, unknown>;
/* A terminal acts on what it is sent, and names, titles, notes and messages are a model's words or anyone's:
 * they are printed as plain text (plain.ts). A message keeps its lines, each later one indented, so a line
 * that starts at the margin is always a new speaker and never something a message said. A terminal folds a
 * line wider than itself back to the margin, so at one (`columns`) every line is folded here first, inside its
 * width and indented; where the output goes elsewhere there is no width to fold to, and lines are left whole. */
const spoken = (who: string, text: string) => `${plainLine(who)}: ${plainText(text).trimEnd().split("\n").join("\n  ")}`;

/** One line as a terminal `width` columns wide shows it without folding any itself: its start, then the rest indented, each cut at a space where there is one. */
export function foldLine(line: string, width: number): string[] {
  const out: string[] = [];
  let rest = line;
  for (let room = width; Bun.stringWidth(rest) > room; room = width - 2) {
    let cut = 0;
    let wide = 0;
    for (const ch of rest) {
      const w = Bun.stringWidth(ch);
      if (cut && wide + w > room) break;
      wide += w;
      cut += ch.length;
    }
    // At its last space, unless that would leave most of the line empty (a long word, or writing without spaces).
    const space = rest.lastIndexOf(" ", cut);
    const at = space >= cut / 2 ? space : cut;
    out.push(`${out.length ? "  " : ""}${rest.slice(0, at).trimEnd()}`);
    rest = rest.slice(at).trimStart();
  }
  out.push(`${out.length ? "  " : ""}${rest}`);
  return out;
}
/** What a task's run came to, for its line in the listing (taskRecordFacts). Empty for a task with no record (not run, or from before them). */
export const taskRecordLine = (task: Pick<TeamTask, "record">, prices: Prices): string => (task.record ? taskRecordFacts(task.record, prices).map((fact) => ` · ${fact}`).join("") : "");
/** What a task changed in its repository and where that is kept (`galahad ship <artifact>` opens a pull request from it). Empty when it kept nothing. */
export const taskChangesLine = (task: Pick<TeamTask, "changes">): string => (task.changes ? ` · ${task.changes.files} file${task.changes.files === 1 ? "" : "s"} changed, kept as ${task.changes.artifact}` : "");

const usage = "galahad squires [add <id> | avatar <id> | dm <id> [message] | room <name> <member…> | chat <room> [message] | task <room> <assignee> <goal> | trail <task-id> [--follow] | provision <id> | memory <id> [text] | engram [on|off] | pause|resume|stop <room|squire|task> <id> | remove <id> [--destroy-workspace] [--yes]]";

export async function teamCommand(api: Api, sub: string | undefined, args: string[], flags: Flags, write: (s: string) => void = console.log, confirm: (question: string) => boolean = () => false, columns?: number): Promise<void> {
  // (Never narrower than twenty columns: below that there is no room to fold into.)
  const print = columns && columns >= 20 ? (text: string) => write(text.split("\n").flatMap((line) => foldLine(line, columns)).join("\n")) : write;
  const string = (key: string) => typeof flags[key] === "string" ? flags[key] as string : undefined;
  if (!sub || sub === "ls") {
    const state = await api.call<TeamSnapshot>("team");
    // (One Galahad made for himself says so: in your conversation with him, or by the worker that asked for it.)
    const maker = (m: Teammate) => (!m.createdBy || m.createdBy === "owner" ? "" : ` · made by ${m.createdBy === "galahad" ? "Galahad" : m.createdBy}`);
    for (const m of state.teammates) print(`${m.id} · ${plainLine(m.name)} · ${m.harness} · ${m.enabled ? "enabled" : "paused"} · ${m.turnsToday}/${m.dailyTurns} turns today · ${m.workspace ? `VM ${m.workspace.id} on ${m.workspace.node}` : "VM not provisioned"}${maker(m)}`);
    // (One you removed is named still: its handle stays taken.)
    for (const m of state.removed ?? []) print(`${m.id} · ${plainLine(m.name)} · removed${m.conversations?.length ? ` · its conversations, kept to read: ${m.conversations.map((room) => `galahad team chat ${room}`).join(", ")}` : ""}`);
    for (const r of state.rooms) print(`${r.id} · ${plainLine(r.name)} · ${r.members.join(", ")}${r.paused ? " · paused" : ""}`);
    // (Money is at your prices, asked for only when a task here has a record to price.)
    const prices: Prices = state.tasks.some((t) => t.record) ? (await api.call<{ prices: Prices }>("prices").catch(() => ({ prices: {} }))).prices : {};
    for (const t of state.tasks) print(`${t.id} · ${t.status}${t.verified ? " (verified)" : ""} · ${t.assignee} · ${plainLine(t.title)}${taskRecordLine(t, prices)}${taskChangesLine(t)}`);
    if (!state.teammates.length) print("Create a squire with galahad squires add <id> --name <name>, or open Squires in the app.");
    return;
  }
  if (sub === "add") {
    const id = args[0];
    const result = await api.call<{ teammate: Teammate }>("saveTeammate", { id, name: string("name") ?? id, ...(string("instructions") ? { instructions: string("instructions") } : {}), ...(string("role") ? { role: string("role") } : {}), ...(string("agent") ? { harness: string("agent") } : {}), ...(string("repo") ? { repository: string("repo") } : {}), ...(string("limit") ? { dailyTurns: Number(string("limit")) } : {}) });
    print(`${plainLine(result.teammate.name)} is ready to chat. VM work is provisioned on a KVM/Kata host when first needed.`); return;
  }
  if (sub === "avatar") {
    const state = await api.call<TeamSnapshot>("team");
    const member = state.teammates.find((m) => m.id === args[0]);
    if (!member) throw new Error("No such squire");
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
    print(`${room.id} · ${plainLine(room.name)}`); return;
  }
  if (sub === "dm" || sub === "chat") {
    const room = sub === "dm" ? (await api.call<{ room: TeamRoom }>("directTeammate", { id: args[0] })).room.id : args[0];
    const text = args.slice(1).join(" ");
    if (text) { await api.call("postTeamMessage", { room, text }); print(`Sent to ${room}; replies continue on the node. Read with galahad team chat ${room}.`); }
    else { const view = await api.call<TeamRoomView>("teamRoom", { id: room }); for (const m of view.messages) print(spoken(plainLine(m.speakerName) ? m.speakerName : m.speaker, m.text)); }
    return;
  }
  if (sub === "task") {
    const goal = args.slice(2).join(" ");
    const gates = typeof flags.gate === "string" ? [flags.gate] : Array.isArray(flags.gate) ? flags.gate : [];
    const { task } = await api.call<{ task: { id: string } }>("createTeamTask", { room: args[0], assignee: args[1], title: string("title") ?? goal.slice(0, 200), goal, gates, ...(string("after") ? { dependsOn: string("after")!.split(",") } : {}) });
    print(`${task.id} queued; completion requires its gates and independent review.`); return;
  }
  if (sub === "trail") {
    // What a task did, as it happened: once, or with --follow until the task has ended.
    if (!args[0]) throw new Error("usage: galahad squires trail <task-id> [--follow]");
    const wait = Math.max(1, Number(string("poll-ms") ?? 1000));
    let after = 0;
    for (;;) {
      const page = await api.call<{ task: { id: string; status: string }; entries: { n: number; at: number; text: string }[]; more: boolean }>("teamTrail", { task: args[0], after });
      for (const entry of page.entries) print(`${new Date(entry.at).toTimeString().slice(0, 8)}  ${plainText(entry.text).trimEnd().split("\n").join("\n          ")}`);
      after = page.entries.at(-1)?.n ?? after;
      if (page.more) continue;
      const working = page.task.status === "running" || page.task.status === "queued";
      if (!working) { if (flags.follow) print(`(ended: ${page.task.status})`); return; }
      if (!flags.follow) { print(`(still ${page.task.status}: galahad squires trail ${page.task.id} --follow)`); return; }
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  if (sub === "provision" && flags.remake) {
    // Its VM made again from the image as it is now: the same VM and /work, a new container. Its own route.
    const kept = ["on", "cpus", "mem", "disk"].filter((flag) => flags[flag] !== undefined);
    if (kept.length) throw new Error(`a VM is made again where and as large as it is: leave out --${kept.join(", --")} (only --network can be chosen again)`);
    const result = await api.call<{ workspace: { id: string; node: string; network?: string } }>("remakeTeammate", { id: args[0], ...(string("network") ? { network: string("network") } : {}) });
    print(`VM ${result.workspace.id} on ${result.workspace.node} made again from its image as it is now · /work kept${result.workspace.network ? ` · ${result.workspace.network === "online" ? "it can reach the internet" : "it reaches the model gateway only"}` : ""}`); return;
  }
  if (sub === "provision") {
    // (Online unless you say `--network gateway`: what its VM can reach is set when it is made.)
    const result = await api.call<{ workspace: { id: string; node: string; network?: string } }>("provisionTeammate", { id: args[0], ...(string("on") ? { on: string("on") } : {}), ...(string("cpus") ? { cpus: Number(string("cpus")) } : {}), ...(string("mem") ? { memoryGb: Number(string("mem")) } : {}), ...(string("disk") ? { diskGb: Number(string("disk")) } : {}), ...(string("network") ? { network: string("network") } : {}) });
    print(`VM ${result.workspace.id} on ${result.workspace.node}${result.workspace.network ? ` · ${result.workspace.network === "online" ? "it can reach the internet" : "it reaches the model gateway only"}` : ""}`); return;
  }
  if (sub === "memory") {
    if (args.length > 1) await api.call("teamMemory", { id: args[0], text: args.slice(1).join(" ") });
    const state = await api.call<TeamSnapshot>("team");
    const m = state.teammates.find((m) => m.id === args[0]); if (!m) throw new Error("No such squire"); print(plainText(m.memory).trim() || "No notes yet."); return;
  }
  // The VMs' notes store (Engram), for every squire of this node: said, or turned on or off (which is yours alone).
  if (sub === "engram") {
    if (args.length > 1 || (args.length === 1 && args[0] !== "on" && args[0] !== "off")) throw new Error("usage: galahad squires engram [on|off]");
    if (!args.length) {
      const on = (await api.call<TeamSnapshot>("team")).engram === true;
      print(on
        ? "The notes store (Engram) is on: a squire's task is given it where its VM has the pinned Engram (Workspace, in the app, says which). Turn it off with: galahad squires engram off"
        : "The notes store (Engram) is off: a squire's tasks are given none. Turn it on with: galahad squires engram on");
      return;
    }
    const { engram } = await api.call<{ engram: boolean }>("teamEngram", { on: args[0] === "on" });
    print(engram
      ? "The notes store (Engram) is on. A squire's task is given it when the squire's VM has the pinned Engram, and says which it was. Notes stay in that VM: they are leads a task checks, never his memory."
      : "The notes store (Engram) is off. What squires kept stays in each VM, unused, under /work/.memory/engram.");
    return;
  }
  // (A squire by either word: `teammate` is what the command took before it was called squires.)
  if (["pause", "resume", "stop"].includes(sub) && ["room", "squire", "teammate", "task"].includes(args[0] ?? "")) {
    await api.call("controlTeam", { action: sub, [args[0] === "squire" ? "teammate" : args[0]!]: args[1] }); print(`${sub}: ${args[0]} ${args[1]}`); return;
  }
  if (sub === "remove") {
    const state = await api.call<TeamSnapshot>("team");
    const member = state.teammates.find((m) => m.id === args[0]);
    if (!member) throw new Error((state.removed ?? []).some((m) => m.id === args[0]) ? "That squire was already removed." : "No such squire");
    const who = `${plainLine(member.name)} (${member.id})`;
    // It has a VM, or one was being made for it when the node last stopped (and may exist, never bound). Either goes
    // with it or it stays: said here before anything is asked of the node, which looks for itself and has the last word.
    const vm = member.workspace ? `its VM ${member.workspace.id} on ${member.workspace.node}` : member.workspaceNode ? `the VM that was being made for it on ${member.workspaceNode}` : null;
    const destroy = flags["destroy-workspace"] === true;
    if (vm && !destroy) throw new Error(`${who} has a persistent workspace (${vm}). Removing it destroys that VM and everything in /work: add --destroy-workspace, or pause it instead (galahad squires pause squire ${member.id}).`);
    const kept = "Its conversations stay to read, and its handle can never be used again.";
    if (!flags.yes && !confirm(destroy ? `Remove ${who} for good, and destroy ${vm ?? "any VM it has"} with everything in /work? ${kept}` : `Remove ${who} for good? ${kept}`)) { print("Nothing was removed."); return; }
    const done = await api.call<{ workspace: "none" | "destroyed" | "gone" | "left" }>("removeTeammate", { id: member.id, ...(destroy ? { destroyWorkspace: true } : {}) });
    // What became of its VM is the node's to say.
    const became = { none: ".", destroyed: " and destroyed its VM workspace.", gone: ". Its VM was already gone from its host.", left: ". Its VM was on a node that has left the fleet, so nothing there was touched." }[done.workspace] ?? ".";
    print(`Removed ${who}${became} What it said stays where it said it; its handle is retired.`);
    return;
  }
  throw new Error(usage);
}
