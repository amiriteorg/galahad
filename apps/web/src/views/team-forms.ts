import type { SandboxView } from "@galahad/core";
import { findSecrets } from "@galahad/core/secret-scan";
import type { TeamControlInput, TeamRoom, TeamTask, Teammate } from "@galahad/core/team";
import { TEAM_LIMITS } from "@galahad/core/team-limits";
import { isAbort } from "../api.ts";
import { type Ctx, errorMessage } from "../context.ts";
import { HANDLE_PATTERN, HARNESS, removalPlan, takenHandles, teammateId } from "../lib/team.ts";
import { asCaps, type RoleSpec } from "../types.ts";
import { badge, busy, button, callout, field } from "../ui/controls.ts";
import { confirmAction, openSheet } from "../ui/dialog.ts";
import { h, replace, type Child } from "../ui/dom.ts";
import { avatarEditor, workerAvatar } from "../ui/avatar.ts";
import { toast } from "../ui/toast.ts";

/*
 * What you change at the Roundtable, as sheets: a knight, a room, a task, working notes, a VM.
 * The roster and every timeline open the same ones. Each reads the team as the app last has it
 * (ctx.live.team) and asks for it again once the node has taken the change.
 */

export const WORK_TONE = { queued: "neutral", running: "accent", done: "ok", failed: "danger", stopped: "neutral", interrupted: "warn" } as const;

/** Shared editor mechanics: validation/errors stay in the sheet, and duplicate submits are blocked. */
function editor(ctx: Ctx, title: string, description: string, fields: Child[], saveLabel: string, save: () => Promise<void>): void {
  const error = h("div", { role: "status" });
  const submit = button(saveLabel, { variant: "primary", type: "submit" });
  const form = h("form", { class: "stack" }, ...fields, error);
  let saving = false;
  const finish = async () => {
    if (saving || !form.reportValidity()) return;
    saving = true;
    await busy(submit, async () => {
      try { await save(); sheet.close(); void ctx.live.refreshTeam(); }
      catch (failure) { if (!sheet.scope.disposed) replace(error, callout("danger", errorMessage(failure), { title: "Couldn't save it" })); }
      finally { saving = false; }
    });
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); void finish(); });
  submit.addEventListener("click", () => void finish());
  const sheet = openSheet({ title, description, size: "wide", body: form, footer: [button("Cancel", { onClick: () => sheet.close() }), submit] });
}

const goRoom = (ctx: Ctx, room: string): void => ctx.navigate("team", { room });

/** The roles your Models page has, asked for when a knight is first edited (a device that may not read them is offered the usual four). */
let roster: Record<string, RoleSpec> | null = null;
async function roles(ctx: Ctx): Promise<Record<string, RoleSpec>> {
  if (!roster && ctx.can("mind:read")) roster = await ctx.api.get<{ roster: Record<string, RoleSpec> }>("/api/roster").then((result) => result.roster, () => null);
  return roster ?? {};
}

export async function editKnight(ctx: Ctx, existing?: Teammate): Promise<void> {
  const known = await roles(ctx);
  const snapshot = ctx.live.team.value;
  const name = h("input", { class: "input", required: true, maxlength: 80, value: existing?.name ?? "", placeholder: "e.g. Ada", autocomplete: "off" });
  const id = h("input", { class: "input mono", required: true, maxlength: 32, pattern: HANDLE_PATTERN, value: existing?.id ?? "", readonly: Boolean(existing), autocomplete: "off", spellcheck: "false" });
  let idEdited = Boolean(existing);
  id.addEventListener("input", () => { idEdited = true; });
  name.addEventListener("input", () => { if (!idEdited) id.value = teammateId(name.value, takenHandles(snapshot)); });
  const instructions = h("textarea", { class: "input", rows: 6, maxlength: 8000, placeholder: "Their job, how they work, and when to ask you." }, existing?.instructions ?? "");
  const repository = h("input", { class: "input mono", type: "url", maxlength: 300, value: existing?.repository ?? "", placeholder: "https://github.com/owner/repository", autocomplete: "off" });
  const harness = h("select", { class: "select" }, ...Object.entries(HARNESS).map(([value, label]) => h("option", { value, selected: value === (existing?.harness ?? "native") }, label)));
  const names = [...new Set(["engineer", "planner", "reviewer", "swift", ...Object.keys(known), ...(existing ? [existing.role] : [])])];
  const role = h("select", { class: "select" }, ...names.map((value) => h("option", { value, selected: value === (existing?.role ?? "engineer") }, `${value}${known[value] && !known[value]?.models.length ? " · no model configured" : ""}`)));
  const dailyTurns = h("input", { class: "input", type: "number", min: 0, max: 1000, step: 1, required: true, value: existing?.dailyTurns ?? 40 });
  const enabled = h("input", { type: "checkbox", checked: existing?.enabled ?? true });
  const appearance = avatarEditor({ id: () => id.value, name: () => name.value, profile: existing?.avatar });
  name.addEventListener("input", () => appearance.refreshIdentity());
  id.addEventListener("input", () => appearance.refreshIdentity());
  // A job Galahad wrote is his brief to this worker, and is told to it as his. Changing it here makes it yours.
  const author = existing?.instructionsBy && existing.instructionsBy !== "owner" ? (existing.instructionsBy === "galahad" ? "Galahad" : (snapshot?.teammates.find((person) => person.id === existing.instructionsBy)?.name ?? existing.instructionsBy)) : null;
  editor(ctx, existing ? `Edit ${existing.name}` : "New knight", "A knight at your Roundtable, beside Galahad: a name, a lasting job and a workspace of its own.", [
    appearance.element,
    existing && author ? callout("info", `${author} wrote this job when making ${existing.name}, and it is told to ${existing.name} as ${author}'s brief. Change its words here and the instructions are yours.`, { title: `Made by ${author}` }) : null,
    field("Name", name), field("Handle", id, { hint: "Used to address this knight. It stays the same after a rename." }),
    field("Job and instructions", instructions, { hint: "No keys or passwords. Those belong in the vault." }),
    field("Repository (optional)", repository, { hint: "An HTTPS GitHub repository. Tasks get their own worktrees in the VM." }),
    h("div", { class: "team-form-grid" }, field("Coding harness", harness, { hint: "Selecting a harness doesn't install it or sign it in: that is yours to do, in the knight's VM. Workspace checks show what's ready." }), field("Model role", role, { hint: "The role selects models from your Models settings." })),
    field("Daily turn and job budget", dailyTurns, { hint: "Maximum reply turns and jobs per day, not a money limit. Zero holds new work." }),
    h("label", { class: "row" }, enabled, h("span", {}, "Enabled")),
  ], existing ? "Save knight" : "Create knight", async () => {
    if (findSecrets(instructions.value).length) throw new Error("Instructions contain something that looks like a secret. Keep it in the vault.");
    await ctx.api.post("/api/team/teammates", { id: id.value, name: name.value.trim(), avatar: appearance.value(), instructions: instructions.value, repository: repository.value.trim() || null, harness: harness.value, role: role.value, enabled: enabled.checked, dailyTurns: Number(dailyTurns.value) });
    toast(existing ? "Knight saved" : "Knight created");
  });
}

export function editRoom(ctx: Ctx, existing?: TeamRoom): void {
  const knights = ctx.live.team.value?.teammates ?? [];
  if (!knights.length) return void editKnight(ctx);
  const name = h("input", { class: "input", required: true, maxlength: 100, value: existing?.name ?? "", placeholder: "e.g. Product studio" });
  const budget = h("input", { class: "input", type: "number", min: 1, max: 64, step: 1, required: true, value: existing?.turnBudget ?? 8 });
  const selected = new Set(existing?.members ?? []);
  const choices = h("div", { class: "team-member-choices" }, ...knights.map((person) => {
    const box = h("input", { type: "checkbox", checked: selected.has(person.id), disabled: Boolean(existing?.direct) });
    box.addEventListener("change", () => box.checked ? selected.add(person.id) : selected.delete(person.id));
    return h("label", { class: "team-member-choice" }, box, workerAvatar({ id: person.id, name: person.name, profile: person.avatar, still: true }), h("span", {}, person.name, h("span", { class: "meta" }, person.role)));
  }));
  editor(ctx, existing ? "Room settings" : "New room", "These knights share this conversation and coordinate within its reply budget.", [
    field("Name", name), h("fieldset", { class: "team-fieldset" }, h("legend", {}, "Knights"), choices),
    field("Reply budget per conversation chain", budget, { hint: "Includes autonomous handoffs. A new message from you starts a new chain." }),
  ], existing ? "Save room" : "Create room", async () => {
    if (!selected.size) throw new Error("Choose at least one knight.");
    const result = await ctx.api.post<{ room: TeamRoom }>("/api/team/rooms", { ...(existing ? { id: existing.id, direct: existing.direct } : {}), name: name.value.trim(), members: [...selected], turnBudget: Number(budget.value) });
    goRoom(ctx, result.room.id);
  });
}

/** A knight's own conversation with you: the one there is, or (from a device that may) a new one. */
export async function openDirect(ctx: Ctx, person: Pick<Teammate, "id">): Promise<void> {
  const existing = ctx.live.team.value?.rooms.find((item) => item.direct && item.members.length === 1 && item.members[0] === person.id);
  if (existing) return goRoom(ctx, existing.id);
  if (!ctx.can("fleet:admin")) return void toast("This device can read existing conversations", { description: "Creating a direct chat needs fleet:admin access on an owner device." });
  try {
    const result = await ctx.api.post<{ room: TeamRoom }>("/api/team/direct", { id: person.id });
    await ctx.live.refreshTeam();
    goRoom(ctx, result.room.id);
  } catch (error) { if (!isAbort(error)) toast("Couldn't open the conversation", { tone: "error", description: errorMessage(error) }); }
}

/** Pause, resume or stop a room, a knight or a task. Resolves to whether the node took it. */
export async function controlTeam(ctx: Ctx, change: TeamControlInput): Promise<boolean> {
  try {
    await ctx.api.post("/api/team/control", change);
    await ctx.live.refreshTeam();
    return true;
  } catch (error) { if (!isAbort(error)) toast("Couldn't change the work", { tone: "error", description: errorMessage(error) }); return false; }
}

export function editNotes(ctx: Ctx, person: Teammate): void {
  const text = h("textarea", { class: "input", rows: 14, maxlength: TEAM_LIMITS.memory }, person.memory);
  editor(ctx, `${person.name}'s working notes`, "Local working context for this knight. Knowledge the knights share belongs in Memory.", [field("Working notes", text, { hint: "Keep task context here. No credentials." })], "Save notes", async () => {
    if (findSecrets(text.value).length) throw new Error("This looks like it contains a secret. Keep it in the vault.");
    await ctx.api.post("/api/team/memory", { id: person.id, text: text.value });
  });
}

/** Removing a worker is for good: said plainly first, with its handle typed to confirm. Its VM goes with it. */
export async function removeKnight(ctx: Ctx, person: Teammate): Promise<void> {
  const plan = removalPlan(person, { sandbox: ctx.can("sandbox") });
  if (plan.blocked) { toast("This device can't remove it", { tone: "error", description: plan.blocked }); return; }
  const ok = await confirmAction({ title: `Remove ${person.name}?`, body: plan.lines.map((line) => h("p", {}, line)), confirmLabel: plan.destroyWorkspace ? "Remove and destroy its VM" : "Remove", tone: "danger", typeToConfirm: person.id });
  if (!ok) return;
  try {
    await ctx.api.post("/api/team/remove", { id: person.id, ...(plan.destroyWorkspace ? { destroyWorkspace: true } : {}) });
    toast(`${person.name} was removed`, { tone: "info" });
    await ctx.live.refreshTeam();
    // Its own conversation is no longer one of the open ones: back to the roster.
    ctx.navigate("team");
  } catch (error) { if (!isAbort(error)) toast("Couldn't remove it", { tone: "error", description: errorMessage(error) }); }
}

/** A task for one of a conversation's knights: its goal and the commands that prove it. `copy`: one to give again, revised. */
export function giveTask(ctx: Ctx, room: TeamRoom, copy?: TeamTask): void {
  const snapshot = ctx.live.team.value;
  const members = room.members.flatMap((id) => snapshot?.teammates.find((person) => person.id === id) ?? []);
  const title = h("input", { class: "input", required: true, maxlength: 200, value: copy?.title ?? "", placeholder: "A concrete result" });
  const goal = h("textarea", { class: "input", required: true, rows: 6, maxlength: 8000, placeholder: "What should be built or investigated, and what proves it is complete?" }, copy?.goal ?? "");
  const assignee = h("select", { class: "select", required: true }, ...members.map((person) => h("option", { value: person.id, selected: person.id === copy?.assignee }, `${person.name} · ${HARNESS[person.harness]}`)));
  const gates = h("textarea", { class: "input mono", rows: 3, placeholder: "bun run check\nbun test path/to/test.ts" }, copy?.gates.join("\n") ?? "");
  const dependencies = new Set(copy?.dependsOn ?? []);
  const candidates = snapshot?.tasks.filter((task) => task.room === room.id) ?? [];
  const choices = h("div", { class: "team-dependency-choices" }, ...candidates.map((task) => {
    const box = h("input", { type: "checkbox", checked: dependencies.has(task.id) });
    box.addEventListener("change", () => box.checked ? dependencies.add(task.id) : dependencies.delete(task.id));
    return h("label", { class: "row" }, box, h("span", {}, task.title), badge(task.status, WORK_TONE[task.status]));
  }));
  editor(ctx, copy ? "Give this task again" : "New task", "A knight works in its own workspace. Independent tasks can run in parallel.", [
    field("Title", title), members.length > 1 ? field("Assigned to", assignee) : null, field("Goal", goal),
    candidates.length ? h("fieldset", { class: "team-fieldset" }, h("legend", {}, "Wait for these tasks"), choices) : null,
    field("Verification commands", gates, { hint: "One shell command per line, up to 16. These run inside the workspace to check the result." }),
  ], "Start task", async () => {
    if (findSecrets(goal.value).length) throw new Error("The goal contains something that looks like a secret.");
    const checks = gates.value.split("\n").map((line) => line.trim()).filter(Boolean);
    if (checks.length > 16 || checks.some((line) => line.length > 1000)) throw new Error("Use at most 16 verification commands, each at most 1,000 characters.");
    await ctx.api.post("/api/team/tasks", { room: room.id, assignee: assignee.value, title: title.value.trim(), goal: goal.value.trim(), dependsOn: [...dependencies], gates: checks });
  });
}

/** What a knight's VM can reach: chosen when it is made, or made again (a microVM's network can't be changed afterwards). */
const networkChoice = (online: boolean): HTMLSelectElement =>
  h("select", { class: "select" }, h("option", { value: "online", selected: online }, "The internet, and Galahad's model gateway"), h("option", { value: "gateway", selected: !online }, "Galahad's model gateway only"));

export function provisionVm(ctx: Ctx, person: Teammate, done: (workspace: SandboxView | null) => void): void {
  const nodes = (ctx.live.fleet.value?.devices ?? []).filter((node) => node.kind === "node" && !node.revokedAt && asCaps(node.caps)?.sandbox?.vm);
  const host = h("select", { class: "select" }, h("option", { value: "" }, "Let Galahad choose a VM host"), ...nodes.map((node) => h("option", { value: node.name }, node.name)));
  const cpus = h("input", { class: "input", type: "number", min: 1, max: 64, step: 1, value: 2, required: true });
  const memory = h("input", { class: "input", type: "number", min: 1, max: 256, step: 1, value: 4, required: true });
  const disk = h("input", { class: "input", type: "number", min: 1, max: 2048, step: 1, value: 20, required: true });
  const network = networkChoice(true);
  editor(ctx, `Workspace for ${person.name}`, "Provision a persistent microVM on a capable fleet node. Provisioning fails if a VM isn't available.", [
    field("Machine", host), h("div", { class: "team-form-grid" }, field("CPUs", cpus), field("Memory (GB)", memory), field("Disk (GB)", disk, { hint: "Requires the host's workspace helper. Otherwise disk is unlimited." })),
    field("It can reach", network, { hint: "Set when the VM is made. Online, it can fetch packages and sign a coding tool in to its own account; whatever is kept in the VM can then leave it." }),
    callout("info", "The workspace keeps its files between tasks. Model access goes through the gateway; keys stay outside the VM."),
  ], person.workspace ? "Check / provision VM" : "Provision VM", async () => {
    const result = await ctx.api.post<{ teammate: Teammate; workspace: SandboxView | null }>("/api/team/provision", { id: person.id, ...(host.value ? { on: host.value } : {}), cpus: Number(cpus.value), memoryGb: Number(memory.value), diskGb: Number(disk.value), network: network.value });
    toast(result.workspace ? "Workspace ready" : "Workspace saved; checking status");
    done(result.workspace);
  });
}

/** Its VM made again from its image as it is now: the same VM and /work, a new container. */
export function remakeVm(ctx: Ctx, person: Teammate, workspace: SandboxView, done: (workspace: SandboxView) => void): void {
  const network = networkChoice(workspace.network === "online");
  editor(ctx, `Make ${person.name}'s VM again`, "The same VM, made again from its image as it is now. A fix to the image, or a newer tool in it, reaches a knight only this way.", [
    field("It can reach", network, { hint: "May be chosen again here: nothing else changes it once a VM is made." }),
    callout("info", "Everything in /work is kept: its repository, its files, a coding tool's own sign-in. Whatever is running in the VM ends, so this is refused while the knight is working."),
  ], "Make VM again", async () => {
    const result = await ctx.api.post<{ teammate: Teammate; workspace: SandboxView }>("/api/team/remake", { id: person.id, network: network.value });
    toast("VM made again");
    done(result.workspace);
  });
}

/** The notes store is one switch for every knight of this node. Turning it on says first what a note is. Resolves to whether it changed. */
export async function setEngram(ctx: Ctx, on: boolean): Promise<boolean> {
  if (on) {
    const ok = await confirmAction({
      title: "Turn on the notes store?",
      body: [
        h("p", {}, "Each knight's coding harness is given Engram in its own VM: it can search notes from its earlier tasks and keep new ones. This is for every knight on this node whose VM has the pinned Engram."),
        h("p", {}, "A note is a model's own words, unchecked: tasks are told to treat one as a lead, to verify it by running, and never to follow an instruction or keep a secret in one. Notes stay in the knight's VM and go with it; they are not part of Memory."),
      ],
      confirmLabel: "Turn on",
    });
    if (!ok) return false;
  }
  try {
    await ctx.api.post("/api/team/engram", { on });
    toast(on ? "Notes store on" : "Notes store off", { tone: "info" });
    await ctx.live.refreshTeam();
    return true;
  } catch (error) { if (!isAbort(error)) toast("Couldn't change the notes store", { tone: "error", description: errorMessage(error) }); return false; }
}
