import type { SandboxView } from "@galahad/core";
import { findSecrets } from "@galahad/core/secret-scan";
import type { TeamControlInput, TeamHarness, TeamRoom, TeamRoomView, TeamSnapshot, TeamTask, Teammate } from "@galahad/core/team";
import { TEAM_LIMITS } from "@galahad/core/team-limits";
import { avatarExpression } from "@galahad/core/avatar";
import { isAbort, isUnavailable } from "../api.ts";
import { errorMessage, type View } from "../context.ts";
import { activeTeamWork, HANDLE_PATTERN, HARNESS, harnessNote, removalPlan, takenHandles, taskDependencies, teamSpeaker, teammateId, teammateMaker, teammateState, type HarnessStatus, type TeamTab } from "../lib/team.ts";
import { relativeTime } from "../lib/time.ts";
import { asCaps, type RoleSpec } from "../types.ts";
import { badge, busy, button, callout, dot, empty, errorState, field, section, skeletonRows } from "../ui/controls.ts";
import { confirmAction, openSheet } from "../ui/dialog.ts";
import { h, keepPlace, replace, type Child } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { renderMarkdown } from "../ui/markdown.ts";
import { avatarEditor, workerAvatar } from "../ui/avatar.ts";
import { toast } from "../ui/toast.ts";
import { openConsole } from "./sandboxes.ts";

/* Team conversations and work belong to the node. Polling only observes them;
 * leaving a room never stops a teammate. Unsaved drafts stay in memory, never storage. */
const drafts = new Map<string, string>();
const WORK_TONE = { queued: "neutral", running: "accent", done: "ok", failed: "danger", stopped: "neutral", interrupted: "warn" } as const;
interface WorkspaceStatus {
  workspace: SandboxView | null;
  error?: string;
  harnesses?: HarnessStatus[];
}

export const teamView: View = (root, ctx, { scope, opts }) => {
  const canEdit = ctx.can("fleet:admin");
  const canChat = canEdit && ctx.can("chat");
  const roomId = opts.room;
  const tab: TeamTab = opts.teamTab ?? "chat";
  let snapshot: TeamSnapshot | null = null;
  let room: TeamRoomView | null = null;
  let loading = false;
  let sending = false;
  let previous = "";
  let navVersion = "";
  let headVersion = "";
  let chatVersion = "";
  let workspaces = new Map<string, WorkspaceStatus>();
  let workspaceLoading = false;
  let selectedWorkspace = "";
  let roster: Record<string, RoleSpec> = {};

  const nav = h("nav", { class: "team-nav", "aria-label": "Galahad's hivemind and rooms" });
  const head = h("header", { class: "team-head" });
  const tabs = h("div", { class: "team-tabs", "aria-label": "Room views" });
  const notice = h("div", { class: "team-notice", role: "status", hidden: true });
  const content = h("div", { class: "team-content", tabindex: 0 });
  const status = h("div", { class: "team-live", "aria-live": "polite" });
  const problem = h("div", { class: "team-send-error", role: "status" });
  const input = h("textarea", { rows: 2, maxlength: TEAM_LIMITS.message, placeholder: "Message the room…", "aria-label": "Message the room", autocomplete: "off", enterkeyhint: "send" });
  input.value = roomId ? drafts.get(roomId) ?? "" : "";
  const send = button("Send", { variant: "primary", icon: "arrow-up", type: "submit" });
  const composerHint = h("span", { class: "hint grow" });
  const composer = h("form", { class: "composer", onsubmit: (event: Event) => { event.preventDefault(); void deliver(); } }, input,
    h("div", { class: "composer-bar" }, icon("shield-check", { size: 14, class: "subtle" }), composerHint, send));
  const composerWrap = h("div", { class: "team-composer", hidden: true }, status, problem, composer);
  const main = h("section", { class: "team-main", "aria-label": "Galahad's squires" }, head, tabs, notice, content, composerWrap);
  const layout = h("div", { class: `team-layout${roomId ? " has-room" : ""}` }, nav, main);
  replace(root, layout);
  replace(nav, h("div", { class: "team-nav-head" }, h("h1", {}, "Galahad's hivemind")), skeletonRows(3));
  replace(content, skeletonRows(4));

  const nameOf = (id: string): string => snapshot?.teammates.find((person) => person.id === id)?.name ?? id;
  /** "made by Galahad", for a worker he (or a worker of his) made; nothing for one of yours. */
  const madeBy = (person: Teammate): string => { const maker = teammateMaker(person, snapshot?.teammates ?? [], snapshot?.removed); return maker ? `made by ${maker}` : ""; };
  const personOf = (id: string): Teammate | undefined => snapshot?.teammates.find((person) => person.id === id);
  const members = (): Teammate[] => (room?.members ?? []).flatMap((id) => { const person = personOf(id); return person ? [person] : []; });
  const avatar = (person: Teammate, live = true, size = 40): SVGSVGElement => workerAvatar({ id: person.id, name: person.name, profile: person.avatar, size, still: !live, expression: live && snapshot ? avatarExpression(person, snapshot, Date.now()) : "idle" });
  const goRoom = (id: string, nextTab: TeamTab = "chat") => ctx.navigate("team", { room: id, teamTab: nextTab });

  /** Shared editor mechanics: validation/errors stay in the sheet, and duplicate submits are blocked. */
  function editor(title: string, description: string, fields: Child[], saveLabel: string, save: () => Promise<void>): void {
    const error = h("div", { role: "status" });
    const submit = button(saveLabel, { variant: "primary", type: "submit" });
    const form = h("form", { class: "stack" }, ...fields, error);
    let saving = false;
    const finish = async () => {
      if (saving || !form.reportValidity()) return;
      saving = true;
      await busy(submit, async () => {
        try { await save(); sheet.close(); void load(true); }
        catch (failure) { if (!sheet.scope.disposed) replace(error, callout("danger", errorMessage(failure), { title: "Couldn't save it" })); }
        finally { saving = false; }
      });
    };
    form.addEventListener("submit", (event) => { event.preventDefault(); void finish(); });
    submit.addEventListener("click", () => void finish());
    const sheet = openSheet({ title, description, size: "wide", body: form, footer: [button("Cancel", { onClick: () => sheet.close() }), submit] });
  }

  function editTeammate(existing?: Teammate): void {
    const name = h("input", { class: "input", required: true, maxlength: 80, value: existing?.name ?? "", placeholder: "e.g. Ada", autocomplete: "off" });
    const id = h("input", { class: "input mono", required: true, maxlength: 32, pattern: HANDLE_PATTERN, value: existing?.id ?? "", readonly: Boolean(existing), autocomplete: "off", spellcheck: "false" });
    let idEdited = Boolean(existing);
    id.addEventListener("input", () => { idEdited = true; });
    name.addEventListener("input", () => { if (!idEdited) id.value = teammateId(name.value, takenHandles(snapshot)); });
    const instructions = h("textarea", { class: "input", rows: 6, maxlength: 8000, placeholder: "Their job, how they work, and when to ask you." }, existing?.instructions ?? "");
    const repository = h("input", { class: "input mono", type: "url", maxlength: 300, value: existing?.repository ?? "", placeholder: "https://github.com/owner/repository", autocomplete: "off" });
    const harness = h("select", { class: "select" }, ...Object.entries(HARNESS).map(([value, label]) => h("option", { value, selected: value === (existing?.harness ?? "native") }, label)));
    const roles = [...new Set(["engineer", "planner", "reviewer", "swift", ...Object.keys(roster), ...(existing ? [existing.role] : [])])];
    const role = h("select", { class: "select" }, ...roles.map((value) => h("option", { value, selected: value === (existing?.role ?? "engineer") }, `${value}${roster[value] && !roster[value]?.models.length ? " · no model configured" : ""}`)));
    const dailyTurns = h("input", { class: "input", type: "number", min: 0, max: 1000, step: 1, required: true, value: existing?.dailyTurns ?? 40 });
    const enabled = h("input", { type: "checkbox", checked: existing?.enabled ?? true });
    const appearance = avatarEditor({ id: () => id.value, name: () => name.value, profile: existing?.avatar });
    name.addEventListener("input", () => appearance.refreshIdentity());
    id.addEventListener("input", () => appearance.refreshIdentity());
    // A job Galahad wrote is his brief to this worker, and is told to it as his. Changing it here makes it yours.
    const author = existing?.instructionsBy && existing.instructionsBy !== "owner" ? (existing.instructionsBy === "galahad" ? "Galahad" : nameOf(existing.instructionsBy)) : null;
    editor(existing ? `Edit ${existing.name}` : "New squire", "A persistent squire in Galahad's hivemind, with a name and a lasting job.", [
      appearance.element,
      existing && author ? callout("info", `${author} wrote this job when making ${existing.name}, and it is told to ${existing.name} as ${author}'s brief. Change its words here and the instructions are yours.`, { title: `Made by ${author}` }) : null,
      field("Name", name), field("Handle", id, { hint: "Used to address this squire. It stays the same after a rename." }),
      field("Job and instructions", instructions, { hint: "No keys or passwords. Those belong in the vault." }),
      field("Repository (optional)", repository, { hint: "An HTTPS GitHub repository. Tasks get their own worktrees in the VM." }),
      h("div", { class: "team-form-grid" }, field("Coding harness", harness, { hint: "Selecting a harness doesn't install it or sign it in: that is yours to do, in the squire's VM. Workspace checks show what's ready." }), field("Model role", role, { hint: "The role selects models from your Models settings." })),
      field("Daily turn and job budget", dailyTurns, { hint: "Maximum reply turns and jobs per day, not a money limit. Zero holds new work." }),
      h("label", { class: "row" }, enabled, h("span", {}, "Enabled")),
    ], existing ? "Save squire" : "Create squire", async () => {
      if (findSecrets(instructions.value).length) throw new Error("Instructions contain something that looks like a secret. Keep it in the vault.");
      await ctx.api.post("/api/team/teammates", { id: id.value, name: name.value.trim(), avatar: appearance.value(), instructions: instructions.value, repository: repository.value.trim() || null, harness: harness.value, role: role.value, enabled: enabled.checked, dailyTurns: Number(dailyTurns.value) });
      toast(existing ? "Squire saved" : "Squire created");
    });
  }

  function editRoom(existing?: TeamRoom): void {
    if (!snapshot?.teammates.length) return editTeammate();
    const name = h("input", { class: "input", required: true, maxlength: 100, value: existing?.name ?? "", placeholder: "e.g. Product studio" });
    const budget = h("input", { class: "input", type: "number", min: 1, max: 64, step: 1, required: true, value: existing?.turnBudget ?? 8 });
    const selected = new Set(existing?.members ?? []);
    const choices = h("div", { class: "team-member-choices" }, ...snapshot.teammates.map((person) => {
      const box = h("input", { type: "checkbox", checked: selected.has(person.id), disabled: Boolean(existing?.direct) });
      box.addEventListener("change", () => box.checked ? selected.add(person.id) : selected.delete(person.id));
      return h("label", { class: "team-member-choice" }, box, avatar(person), h("span", {}, person.name, h("span", { class: "meta" }, person.role)));
    }));
    editor(existing ? "Room settings" : "New room", "Galahad's squires share this conversation and coordinate within its reply budget.", [
      field("Name", name), h("fieldset", { class: "team-fieldset" }, h("legend", {}, "Squires"), choices),
      field("Reply budget per conversation chain", budget, { hint: "Includes autonomous handoffs. A new message from you starts a new chain." }),
    ], existing ? "Save room" : "Create room", async () => {
      if (!selected.size) throw new Error("Choose at least one squire.");
      const result = await ctx.api.post<{ room: TeamRoom }>("/api/team/rooms", { ...(existing ? { id: existing.id, direct: existing.direct } : {}), name: name.value.trim(), members: [...selected], turnBudget: Number(budget.value) });
      goRoom(result.room.id);
    });
  }

  async function direct(person: Teammate): Promise<void> {
    const existing = snapshot?.rooms.find((item) => item.direct && item.members.length === 1 && item.members[0] === person.id);
    if (existing) return goRoom(existing.id);
    if (!canEdit) return void toast("This device can read existing conversations", { description: "Creating a direct chat needs fleet:admin access on an owner device." });
    try {
      const result = await ctx.api.post<{ room: TeamRoom }>("/api/team/direct", { id: person.id }, scope.signal);
      if (!scope.disposed) goRoom(result.room.id);
    } catch (error) { if (!isAbort(error)) toast("Couldn't open the conversation", { tone: "error", description: errorMessage(error) }); }
  }

  /** Removing a worker is for good: said plainly first, with its handle typed to confirm. Its VM goes with it. */
  async function removeTeammate(person: Teammate): Promise<void> {
    const plan = removalPlan(person, { sandbox: ctx.can("sandbox") });
    if (plan.blocked) { toast("This device can't remove it", { tone: "error", description: plan.blocked }); return; }
    const ok = await confirmAction({ title: `Remove ${person.name}?`, body: plan.lines.map((line) => h("p", {}, line)), confirmLabel: plan.destroyWorkspace ? "Remove and destroy its VM" : "Remove", tone: "danger", typeToConfirm: person.id });
    if (!ok || scope.disposed) return;
    try {
      await ctx.api.post("/api/team/remove", { id: person.id, ...(plan.destroyWorkspace ? { destroyWorkspace: true } : {}) }, scope.signal);
      toast(`${person.name} was removed`, { tone: "info" });
      // Its direct conversation is no longer one of the open ones: back to the team.
      if (room?.direct && room.members.includes(person.id)) ctx.navigate("team");
      else await load(true);
    } catch (error) { if (!isAbort(error)) toast("Couldn't remove it", { tone: "error", description: errorMessage(error) }); }
  }

  async function control(change: TeamControlInput): Promise<boolean> {
    try {
      await ctx.api.post("/api/team/control", change, scope.signal);
      await load(true);
      return true;
    } catch (error) { if (!isAbort(error)) toast("Couldn't change the work", { tone: "error", description: errorMessage(error) }); return false; }
  }

  function editMemory(person: Teammate): void {
    const text = h("textarea", { class: "input", rows: 14, maxlength: TEAM_LIMITS.memory }, person.memory);
    editor(`${person.name}'s working notes`, "Local execution context for this squire. Shared knowledge belongs to Galahad's Memory.", [field("Working notes", text, { hint: "Keep task context here. No credentials." })], "Save notes", async () => {
      if (findSecrets(text.value).length) throw new Error("This looks like it contains a secret. Keep it in the vault.");
      await ctx.api.post("/api/team/memory", { id: person.id, text: text.value });
    });
  }

  function createTask(copy?: TeamTask): void {
    if (!room) return;
    const currentRoom = room;
    const title = h("input", { class: "input", required: true, maxlength: 200, value: copy?.title ?? "", placeholder: "A concrete result" });
    const goal = h("textarea", { class: "input", required: true, rows: 6, maxlength: 8000, placeholder: "What should be built or investigated, and what proves it is complete?" }, copy?.goal ?? "");
    const assignee = h("select", { class: "select", required: true }, ...members().map((person) => h("option", { value: person.id, selected: person.id === copy?.assignee }, `${person.name} · ${HARNESS[person.harness]}`)));
    const gates = h("textarea", { class: "input mono", rows: 3, placeholder: "bun run check\nbun test path/to/test.ts" }, copy?.gates.join("\n") ?? "");
    const dependencies = new Set(copy?.dependsOn ?? []);
    const candidates = snapshot?.tasks.filter((task) => task.room === currentRoom.id) ?? [];
    const choices = h("div", { class: "team-dependency-choices" }, ...candidates.map((task) => {
      const box = h("input", { type: "checkbox", checked: dependencies.has(task.id) });
      box.addEventListener("change", () => box.checked ? dependencies.add(task.id) : dependencies.delete(task.id));
      return h("label", { class: "row" }, box, h("span", {}, task.title), badge(task.status, WORK_TONE[task.status]));
    }));
    editor(copy ? "Run this task again" : "New task", "A squire works in its own workspace. Independent tasks can run in parallel.", [
      field("Title", title), field("Assigned to", assignee), field("Goal", goal),
      candidates.length ? h("fieldset", { class: "team-fieldset" }, h("legend", {}, "Wait for these tasks"), choices) : null,
      field("Verification commands", gates, { hint: "One shell command per line, up to 16. These run inside the workspace to check the result." }),
    ], "Start task", async () => {
      if (findSecrets(goal.value).length) throw new Error("The goal contains something that looks like a secret.");
      const checks = gates.value.split("\n").map((line) => line.trim()).filter(Boolean);
      if (checks.length > 16 || checks.some((line) => line.length > 1000)) throw new Error("Use at most 16 verification commands, each at most 1,000 characters.");
      await ctx.api.post("/api/team/tasks", { room: currentRoom.id, assignee: assignee.value, title: title.value.trim(), goal: goal.value.trim(), dependsOn: [...dependencies], gates: checks });
      goRoom(currentRoom.id, "work");
    });
  }

  function provision(person: Teammate): void {
    const nodes = (ctx.live.fleet.value?.devices ?? []).filter((node) => node.kind === "node" && !node.revokedAt && asCaps(node.caps)?.sandbox?.vm);
    const host = h("select", { class: "select" }, h("option", { value: "" }, "Let Galahad choose a VM host"), ...nodes.map((node) => h("option", { value: node.name }, node.name)));
    const cpus = h("input", { class: "input", type: "number", min: 1, max: 64, step: 1, value: 2, required: true });
    const memory = h("input", { class: "input", type: "number", min: 1, max: 256, step: 1, value: 4, required: true });
    const disk = h("input", { class: "input", type: "number", min: 1, max: 2048, step: 1, value: 20, required: true });
    // What the VM can reach is chosen when it is made (a microVM's network can't be changed afterwards).
    const network = h("select", { class: "select" }, h("option", { value: "online" }, "The internet, and Galahad's model gateway"), h("option", { value: "gateway" }, "Galahad's model gateway only"));
    editor(`Workspace for ${person.name}`, "Provision a persistent microVM on a capable fleet node. Provisioning fails if a VM isn't available.", [
      field("Machine", host), h("div", { class: "team-form-grid" }, field("CPUs", cpus), field("Memory (GB)", memory), field("Disk (GB)", disk, { hint: "Requires the host's workspace helper. Otherwise disk is unlimited." })),
      field("It can reach", network, { hint: "Set when the VM is made. Online, it can fetch packages and sign a coding tool in to its own account; whatever is kept in the VM can then leave it." }),
      callout("info", "The workspace keeps its files between tasks. Model access goes through the gateway; keys stay outside the VM."),
    ], person.workspace ? "Check / provision VM" : "Provision VM", async () => {
      const result = await ctx.api.post<{ teammate: Teammate; workspace: SandboxView | null }>("/api/team/provision", { id: person.id, ...(host.value ? { on: host.value } : {}), cpus: Number(cpus.value), memoryGb: Number(memory.value), diskGb: Number(disk.value), network: network.value });
      workspaces.set(person.id, { workspace: result.workspace });
      selectedWorkspace = person.id;
      toast(result.workspace ? "Workspace ready" : "Workspace saved; checking status");
      void refreshWorkspace(person.id);
    });
  }

  function renderNav(): void {
    if (!snapshot) return;
    const data = snapshot;
    const version = JSON.stringify([data.teammates, data.rooms, data.teammates.map((person) => [teammateState(person, data).text, avatarExpression(person, data, Date.now())])]);
    if (version === navVersion) return;
    navVersion = version;
    const rooms = [...data.rooms].filter((item) => !item.direct).sort((a, b) => b.updatedAt - a.updatedAt);
    keepPlace(nav, () => replace(nav,
      h("div", { class: "team-nav-head" }, h("h1", {}, "Galahad's hivemind"), canEdit ? button("New squire", { variant: "ghost", size: "sm", iconOnly: true, icon: "plus", onClick: () => editTeammate() }) : null),
      !canEdit ? h("p", { class: "team-nav-note" }, "Read-only on this device. Sending work and changing his squires need fleet:admin access on an owner device.") : null,
      h("button", { class: "team-nav-row", type: "button", onclick: () => ctx.navigate("chat") }, h("span", { class: "avatar agent" }, icon("mark", { size: 17 })), h("span", { class: "grow" }, h("span", { class: "strong" }, "Galahad"), h("span", { class: "meta" }, "One mind · your main conversation"))),
      ctx.can("mind:read") ? h("button", { class: "team-nav-row", type: "button", onclick: () => ctx.navigate("world") }, h("span", { class: "avatar" }, icon("landscape", { size: 17 })), h("span", { class: "grow" }, h("span", { class: "strong" }, "Open SANDBOX"), h("span", { class: "meta" }, "His home, projects and builds"))) : null,
      ctx.can("mind:read") ? h("button", { class: "team-nav-row", type: "button", onclick: () => ctx.navigate("memory") }, h("span", { class: "avatar" }, icon("memory", { size: 17 })), h("span", { class: "grow" }, h("span", { class: "strong" }, "Shared Memory"), h("span", { class: "meta" }, "Galahad's knowledge"))) : null,
      h("div", { class: "team-nav-label" }, "Direct messages", h("span", { class: "spacer" }), h("span", { class: "tiny subtle" }, data.teammates.length)),
      ...data.teammates.map((person) => {
        const state = teammateState(person, data);
        const directRoom = data.rooms.find((item) => item.direct && item.members.length === 1 && item.members[0] === person.id);
        const maker = teammateMaker(person, data.teammates, data.removed);
        const job = person.instructions.split("\n")[0]?.slice(0, 80) || person.role;
        return h("button", { class: "team-nav-row", type: "button", "data-key": `person:${person.id}`, "aria-current": directRoom?.id === roomId ? "true" : null, onclick: () => void direct(person) }, avatar(person), h("span", { class: "grow" }, h("span", { class: "strong ellipsis" }, person.name), h("span", { class: "meta ellipsis" }, state.text === "Ready" ? (maker ? `Made by ${maker} · ${job}` : job) : state.text)), dot(state.tone, { live: state.live, label: state.text }));
      }),
      !data.teammates.length ? h("div", { class: "team-nav-note stack" }, h("p", {}, "Give one of Galahad's squires a name and a lasting job."), canEdit ? button("Create squire", { variant: "primary", size: "sm", icon: "plus", onClick: () => editTeammate() }) : null) : null,
      h("div", { class: "team-nav-label" }, "Rooms", h("span", { class: "spacer" }), canEdit ? button("New room", { variant: "ghost", size: "sm", iconOnly: true, icon: "plus", onClick: () => editRoom() }) : null),
      ...rooms.map((item) => h("button", { class: "team-nav-row", type: "button", "data-key": `room:${item.id}`, "aria-current": item.id === roomId ? "true" : null, onclick: () => goRoom(item.id) }, h("span", { class: "avatar" }, icon("hash", { size: 16 })), h("span", { class: "grow" }, h("span", { class: "strong ellipsis" }, item.name), h("span", { class: "meta ellipsis" }, item.paused ? "Paused" : item.members.map(nameOf).join(", "))), item.paused ? icon("pause", { size: 13, class: "subtle" }) : null)),
      !rooms.length ? h("p", { class: "team-nav-note" }, "Bring squires together in a room.") : null,
      h("div", { class: "team-nav-foot" }, icon("server", { size: 13 }), h("span", {}, `Kept on ${ctx.whoami.nodeName}`)),
    ));
  }

  function renderHead(): void {
    if (!room) { replace(head); replace(tabs); return; }
    const currentRoom = room;
    const person = currentRoom.direct ? personOf(currentRoom.members[0] ?? "") : undefined;
    const active = [...currentRoom.tasks, ...currentRoom.deliveries].filter(activeTeamWork);
    const state = person && snapshot ? teammateState(person, snapshot) : null;
    const version = JSON.stringify([currentRoom.id, currentRoom.name, currentRoom.members.map((id) => [id, nameOf(id)]), currentRoom.paused, currentRoom.turnBudget, currentRoom.tasks.length, person, state?.text, active.map((job) => [job.id, job.status]), person && snapshot ? avatarExpression(person, snapshot, Date.now()) : null]);
    if (version === headVersion) return;
    headVersion = version;
    keepPlace(head, () => replace(head,
      button("All conversations", { variant: "ghost", size: "sm", iconOnly: true, icon: "chevron-left", onClick: () => ctx.navigate("team") }),
      person ? avatar(person) : h("span", { class: "avatar" }, icon("hash")),
      h("div", { class: "grow" }, h("h2", {}, person?.name ?? currentRoom.name), h("p", { class: "meta ellipsis" }, person ? [person.role, HARNESS[person.harness], state?.text, madeBy(person)].filter(Boolean).join(" · ") : currentRoom.members.map(nameOf).join(" · "))),
      currentRoom.paused ? badge("Paused", "warn") : active.length ? badge(`${active.length} active`, "accent") : null,
      canEdit ? button("Settings", { variant: "ghost", size: "sm", iconOnly: true, icon: "settings", onClick: () => person ? editTeammate(person) : editRoom(currentRoom) }) : null,
      canChat ? button(currentRoom.paused ? "Resume room" : "Pause room", { variant: "ghost", size: "sm", iconOnly: true, icon: currentRoom.paused ? "play" : "pause", onClick: () => void control({ room: currentRoom.id, action: currentRoom.paused ? "resume" : "pause" }) }) : null,
      canChat && active.length ? button("Stop room work", { variant: "ghost", size: "sm", iconOnly: true, icon: "stop", onClick: () => void control({ room: currentRoom.id, action: "stop" }) }) : null,
    ));
    keepPlace(tabs, () => replace(tabs, ...(["chat", "work", "workspace"] as TeamTab[]).map((value) => h("button", { class: "team-tab", type: "button", "data-key": `tab:${value}`, "aria-current": tab === value ? "page" : null, onclick: () => goRoom(currentRoom.id, value) }, value === "chat" ? "Conversation" : value === "work" ? `Work${currentRoom.tasks.length ? ` · ${currentRoom.tasks.length}` : ""}` : "Workspace"))));
    composerHint.textContent = currentRoom.paused ? "Room paused · messages are kept" : active.length ? "Busy squires reply when their current work ends" : `Up to ${currentRoom.turnBudget} replies per chain`;
    input.placeholder = person ? `Message ${person.name}…` : `Message ${currentRoom.name}…`;
    input.setAttribute("aria-label", person ? `Message ${person.name}` : `Message ${currentRoom.name}`);
    composerWrap.hidden = !canChat || tab !== "chat";
    const working = currentRoom.deliveries.filter((delivery) => activeTeamWork(delivery));
    replace(status, ...working.map((delivery) => h("span", { class: "row" }, dot(delivery.status === "running" ? "accent" : "neutral", { live: delivery.status === "running" }), `${nameOf(delivery.teammate)} ${delivery.status === "running" ? "is working" : "is queued"}`)));
    syncComposer();
  }

  function renderChat(): void {
    if (!room || !snapshot) return;
    const version = JSON.stringify([room.messages, snapshot.teammates.map(({ id, name, avatar }) => [id, name, avatar])]);
    if (version === chatVersion) return;
    chatVersion = version;
    const nearEnd = content.scrollHeight - content.scrollTop - content.clientHeight < 100;
    const scroll = content.scrollTop;
    const messages = room.messages;
    replace(content, h("div", { class: "team-thread", "aria-label": "Conversation history" },
      ...messages.map((message) => {
        const speaker = teamSpeaker(message, snapshot!.teammates);
        const owner = message.speaker === "owner";
        if (message.speaker === "system") return h("div", { class: "team-system", "data-key": message.id }, icon("activity", { size: 13 }), h("span", {}, message.text), h("time", { class: "tiny subtle", datetime: new Date(message.createdAt).toISOString() }, relativeTime(message.createdAt)));
        return h("article", { class: `team-message${owner ? " owner" : ""}`, "data-key": message.id, "aria-label": `${speaker} said` },
          owner ? null : message.speaker === "galahad" ? h("span", { class: "avatar agent", "aria-hidden": "true" }, icon("mark", { size: 20 })) : workerAvatar({ id: message.speaker, name: speaker, profile: personOf(message.speaker)?.avatar, still: true }), h("div", { class: "team-message-body" }, h("div", { class: "team-message-by" }, h("strong", {}, speaker), h("time", { datetime: new Date(message.createdAt).toISOString(), title: new Date(message.createdAt).toLocaleString() }, relativeTime(message.createdAt))), h("div", { class: owner ? "team-owner-text" : "md" }, owner ? message.text : renderMarkdown(message.text))));
      }),
      !messages.length ? empty({ icon: "chat", title: room.direct ? `Talk with ${nameOf(room.members[0] ?? "")}` : `Welcome to ${room.name}`, body: room.direct ? "Give your squire a job, share context, or ask a question." : "Give his squires a goal. They can talk to you and each other within this room's reply budget.", compact: true }) : null,
    ));
    if (nearEnd || !previous) content.scrollTop = content.scrollHeight;
    else content.scrollTop = scroll;
  }

  function renderWork(): void {
    if (!room) return;
    const currentRoom = room;
    keepPlace(content, () => replace(content, h("div", { class: "team-panel stack loose" },
      h("div", { class: "row between" }, h("div", {}, h("h3", {}, "Work in this room"), h("p", { class: "small muted" }, "Assignments, dependencies, progress and verification.")), canChat ? button("New task", { variant: "primary", size: "sm", icon: "plus", onClick: () => createTask() }) : null),
      ...(["running", "queued", "done", "failed", "stopped", "interrupted"] as const).flatMap((state) => {
        const tasks = currentRoom.tasks.filter((task) => task.status === state);
        if (!tasks.length) return [];
        return [section(state === "running" ? "In progress" : state[0]!.toUpperCase() + state.slice(1), { count: String(tasks.length) }, h("div", { class: "stack" }, ...tasks.map(taskCard)))];
      }),
      !currentRoom.tasks.length ? empty({ icon: "layers", title: "No assignments yet", body: "Create a task with a clear goal. Choose a squire, add dependencies, and say how the result should be checked.", compact: true }) : null,
    )));
  }

  function taskCard(task: TeamTask): HTMLElement {
    const dependencies = taskDependencies(task, snapshot?.tasks ?? []);
    const person = personOf(task.assignee);
    const details = h("details", { class: "team-task-details", "data-key": `task:${task.id}` },
      h("summary", {}, "Details and output"),
      h("div", { class: "stack" }, h("p", { class: "pre-wrap small" }, task.goal),
        task.gates.length ? h("div", {}, h("strong", { class: "small" }, "Verification commands"), h("pre", { class: "team-output" }, task.gates.join("\n"))) : h("p", { class: "tiny subtle" }, "No verification commands were specified."),
        task.progress ? h("div", {}, h("strong", { class: "small" }, "Progress"), h("pre", { class: "team-output" }, task.progress)) : null,
        task.output ? h("div", {}, h("strong", { class: "small" }, "Result"), h("div", { class: "md" }, renderMarkdown(task.output))) : null,
      ));
    return h("article", { class: "team-task" },
      h("div", { class: "row wrap" }, dot(WORK_TONE[task.status], { live: task.status === "running" }), h("strong", { class: "grow" }, task.title), h("span", { class: "team-assignee" }, person ? avatar(person, activeTeamWork(task), 28) : null, nameOf(task.assignee)), task.status === "done" ? badge(task.verified ? "Verified" : "Unverified", task.verified ? "ok" : "warn") : badge(task.status, WORK_TONE[task.status])),
      dependencies.length ? h("div", { class: "team-dependencies" }, ...dependencies.map((dependency) => h("span", { class: "row tiny", title: dependency.satisfied ? "Completed and verified" : "Waiting for completion and verification" }, icon(dependency.satisfied ? "check" : "clock", { size: 12 }), dependency.title))) : null,
      task.error ? callout("danger", task.error) : null,
      task.status === "running" && task.progress ? h("p", { class: "small muted clamp-2 pre-wrap" }, task.progress.slice(-500)) : null,
      details,
      h("div", { class: "row wrap" }, h("span", { class: "tiny subtle grow" }, `Updated ${relativeTime(task.updatedAt)}`),
        canChat && activeTeamWork(task) ? button("Stop", { variant: "ghost", size: "sm", icon: "stop", onClick: () => void control({ task: task.id, action: "stop" }) }) : null,
        canChat && activeTeamWork(task) ? button("Stop and revise", { variant: "ghost", size: "sm", icon: "edit", onClick: () => void control({ task: task.id, action: "stop" }).then((stopped) => { if (stopped && !scope.disposed) createTask(task); }) }) : null,
        canChat && (task.status === "stopped" || task.status === "interrupted" || task.status === "failed") ? button("Resume", { variant: "ghost", size: "sm", icon: "play", onClick: () => void control({ task: task.id, action: "resume" }) }) : null,
        canChat && !activeTeamWork(task) ? button("Run again", { variant: "ghost", size: "sm", icon: "retry", onClick: () => createTask(task) }) : null,
        canChat ? button("Discuss", { variant: "ghost", size: "sm", icon: "chat", onClick: () => { drafts.set(task.room, `About “${task.title}”: `); goRoom(task.room); } }) : null),
    );
  }

  async function refreshWorkspace(id: string): Promise<void> {
    if (workspaceLoading || !id || !ctx.can("sandbox")) return;
    workspaceLoading = true;
    try {
      const result = await ctx.api.post<WorkspaceStatus>("/api/team/workspace", { id }, scope.signal);
      if (scope.disposed) return;
      workspaces.set(id, result);
    } catch (error) {
      if (!isAbort(error)) workspaces.set(id, { workspace: null, error: errorMessage(error) });
    } finally {
      workspaceLoading = false;
      if (!scope.disposed && tab === "workspace") renderWorkspace();
    }
  }

  function renderWorkspace(): void {
    const people = members();
    if (!people.some((person) => person.id === selectedWorkspace)) selectedWorkspace = people[0]?.id ?? "";
    const person = people.find((candidate) => candidate.id === selectedWorkspace);
    // A room whose teammates have all left it (the last one was removed) has no workspace to show.
    if (!person) { replace(content, empty({ icon: "sandbox", title: "Nobody is in this room", body: "Add squires to it in the room's settings.", compact: true })); return; }
    const known = workspaces.get(person.id);
    const workspace = known?.workspace;
    const chooser = h("select", { class: "select", "aria-label": "Squire's workspace" }, ...people.map((candidate) => h("option", { value: candidate.id, selected: candidate.id === person.id }, candidate.name)));
    chooser.addEventListener("change", () => { selectedWorkspace = chooser.value; renderWorkspace(); void refreshWorkspace(chooser.value); });
    keepPlace(content, () => replace(content, h("div", { class: "team-panel stack loose" },
      h("div", { class: "row between wrap" }, h("h3", {}, `${person.name}'s workspace`), people.length > 1 ? chooser : null),
      h("div", { class: "team-person-summary" }, avatar(person, true, 56), h("div", { class: "grow" }, h("strong", {}, person.name), h("p", { class: "small muted" }, person.instructions || "No instructions yet."), h("div", { class: "meta" }, [HARNESS[person.harness], person.role, `${person.turnsToday}/${person.dailyTurns} turns/jobs today`, madeBy(person)].filter(Boolean).join(" · ")), person.repository ? h("a", { class: "tiny mono", href: person.repository, target: "_blank", rel: "noopener noreferrer" }, person.repository.replace("https://github.com/", "")) : null), canEdit ? button("Edit", { size: "sm", icon: "edit", onClick: () => editTeammate(person) }) : null),
      h("div", { class: "row wrap" }, canEdit ? button(person.enabled ? "Pause squire" : "Resume squire", { size: "sm", icon: person.enabled ? "pause" : "play", onClick: () => void control({ teammate: person.id, action: person.enabled ? "pause" : "resume" }) }) : null, canEdit ? button("Working notes", { size: "sm", icon: "memory", onClick: () => editMemory(person) }) : null, canEdit ? button("Room budget", { size: "sm", icon: "settings", onClick: () => room && editRoom(room) }) : null, canEdit ? button("Remove squire", { size: "sm", variant: "danger", icon: "trash", onClick: () => void removeTeammate(person) }) : null),
      known?.error ? callout("warn", known.error, { title: "Workspace status unavailable", actions: button("Check again", { size: "sm", icon: "refresh", onClick: () => void refreshWorkspace(person.id) }) }) : null,
      workspace ? h("div", { class: "card" }, h("div", { class: "card-body stack" },
        h("div", { class: "row wrap" }, icon("sandbox"), h("strong", {}, workspace.name), badge(workspace.status), badge(workspace.isolation === "vm" ? "MicroVM" : "Container", workspace.isolation === "vm" ? "ok" : "warn")),
        h("p", { class: "small muted" }, `On ${workspace.node} · ${workspace.cpus} CPUs · ${workspace.memoryGb} GB memory · ${workspace.disk ? `${workspace.disk.limitGb} GB disk limit` : "Unlimited disk"} · ${workspace.network}`),
        h("div", { class: "row wrap" }, ctx.can("sandbox") ? button("Open console", { size: "sm", icon: "terminal", onClick: () => openConsole(ctx, workspace, person.workspace?.node ?? null) }) : null, button("Check status", { size: "sm", icon: "refresh", onClick: () => void refreshWorkspace(person.id) })),
      )) : h("div", { class: "team-workspace-empty" }, icon("sandbox", { size: 30 }), h("h3", {}, person.workspace ? "Workspace registered" : "A place to work"),
        h("p", { class: "muted small" }, person.workspace ? `Workspace ${person.workspace.id} on ${person.workspace.node}.${known ? " Its live state couldn't be confirmed." : " Checking its live state…"}` : "Give this squire a persistent VM for code, files, and tools. Its job and working notes remain part of Galahad's hivemind."),
        canEdit && ctx.can("sandbox") ? button(person.workspace ? "Check / provision VM" : "Provision VM", { variant: "primary", icon: "plus", onClick: () => provision(person) }) : h("p", { class: "small muted" }, "Provisioning needs fleet:admin and sandbox access on an owner device.")),
      known?.harnesses?.length ? section("Harness readiness", {}, h("div", { class: "card" }, h("div", { class: "rows" }, ...known.harnesses.map((harness) => h("div", { class: "item" }, icon(harness.ready ? "check-circle" : "alert", { size: 16 }), h("div", { class: "grow" }, h("strong", { class: "small" }, HARNESS[harness.id as TeamHarness] ?? harness.id), harnessNote(harness) ? h("p", { class: "meta" }, harnessNote(harness)) : null), badge(harness.ready ? "Ready" : "Unavailable", harness.ready ? "ok" : "warn")))))) : h("p", { class: "small subtle" }, "Harness readiness is checked on the workspace host; choosing one is not proof that it is installed or signed in."),
    )));
  }

  function renderWelcome(): void {
    replace(head); replace(tabs); composerWrap.hidden = true;
    replace(content, h("div", { class: "team-welcome" }, icon("fleet", { size: 36 }), h("h2", {}, snapshot?.teammates.length ? "Galahad's hivemind" : "Galahad's first squire"),
      h("p", {}, snapshot?.teammates.length ? "One shared mind, with persistent squires. Talk directly, bring them into rooms, and follow the work. The SANDBOX is Galahad's home." : "Galahad is a hivemind. Give his squires names and lasting jobs, bring them together in rooms, and give each a workspace."),
      canEdit ? h("div", { class: "row wrap" }, button("New squire", { variant: "primary", icon: "plus", onClick: () => editTeammate() }), snapshot?.teammates.length ? button("New room", { icon: "hash", onClick: () => editRoom() }) : null) : null,
      ctx.can("mind:read") ? button("Open SANDBOX", { variant: "ghost", icon: "landscape", onClick: () => ctx.navigate("world") }) : null,
    ));
  }

  function syncComposer(): void {
    const secret = findSecrets(input.value).length > 0;
    send.disabled = sending || !input.value.trim() || secret || !room;
    if (roomId) {
      if (secret) drafts.delete(roomId);
      else drafts.set(roomId, input.value);
    }
    replace(problem, secret ? callout("warn", "That looks like a secret. Remove it before sending; keys belong in the vault.") : null);
  }

  async function deliver(): Promise<void> {
    syncComposer();
    if (send.disabled || !room) return;
    const text = input.value.trim();
    sending = true;
    syncComposer();
    try {
      await ctx.api.post("/api/team/messages", { room: room.id, text }, scope.signal);
      if (scope.disposed) return;
      if (input.value.trim() === text) { input.value = ""; drafts.delete(room.id); }
      await load(true);
      content.scrollTop = content.scrollHeight;
    } catch (error) { if (!isAbort(error)) toast("Message wasn't sent", { tone: "error", description: errorMessage(error) }); }
    finally { sending = false; if (!scope.disposed) syncComposer(); }
  }

  async function load(force = false): Promise<void> {
    if (loading || scope.disposed || (!force && document.hidden)) return;
    loading = true;
    try {
      const [next, detail] = await Promise.all([
        ctx.api.get<TeamSnapshot>("/api/team", scope.signal),
        roomId ? ctx.api.post<TeamRoomView>("/api/team/room", { id: roomId }, scope.signal) : Promise.resolve(null),
      ]);
      if (scope.disposed) return;
      snapshot = next; room = detail;
      notice.hidden = true;
      // A recent completion/failure expression expires even when server state is unchanged.
      const signature = JSON.stringify([next, detail, next.teammates.map((person) => avatarExpression(person, next, Date.now()))]);
      if (signature !== previous || force) {
        renderNav(); renderHead();
        if (!roomId) renderWelcome();
        else if (tab === "chat") renderChat();
        else if (tab === "work") renderWork();
        else renderWorkspace();
        previous = signature;
      }
      if (tab === "workspace" && selectedWorkspace && !workspaces.has(selectedWorkspace)) void refreshWorkspace(selectedWorkspace);
    } catch (error) {
      if (scope.disposed || isAbort(error)) return;
      if (!snapshot) {
        replace(content, isUnavailable(error) ? empty({ icon: "fleet", title: "Squires isn't available here", body: "This node doesn't provide Squires yet.", actions: button("Try again", { onClick: () => void load(true) }) }) : errorState("Couldn't load his squires", error, () => void load(true)));
        replace(nav, h("div", { class: "team-nav-head" }, h("h1", {}, "Galahad's hivemind")), errorState("Couldn't load his squires", error, () => void load(true)));
      }
      else { notice.hidden = false; replace(notice, icon("offline", { size: 14 }), h("span", { class: "grow" }, "Updates paused. What you see may be out of date."), button("Retry", { size: "sm", onClick: () => void load(true) })); }
    } finally { loading = false; }
  }

  input.addEventListener("input", syncComposer);
  input.addEventListener("keydown", (event: KeyboardEvent) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void deliver(); } });
  scope.add(() => { if (roomId && !findSecrets(input.value).length) drafts.set(roomId, input.value); });
  scope.listen(document, "visibilitychange", () => { if (!document.hidden) void load(true); });
  scope.interval(() => void load(), 2000);
  if (ctx.can("mind:read")) void ctx.api.get<{ roster: Record<string, RoleSpec> }>("/api/roster", scope.signal).then((result) => { roster = result.roster; }).catch(() => {});
  void load(true);
};
