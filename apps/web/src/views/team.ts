import type { SandboxView } from "@galahad/core";
import { findSecrets } from "@galahad/core/secret-scan";
import type { TeamEngramStatus, TeamHarness, TeamRoomView, TeamSnapshot, TeamTask, Teammate } from "@galahad/core/team";
import { TEAM_LIMITS } from "@galahad/core/team-limits";
import { taskRecordFacts } from "@galahad/core/team-record";
import type { Price } from "@galahad/core/spend";
import { avatarExpression } from "@galahad/core/avatar";
import { isAbort, isUnavailable } from "../api.ts";
import { errorMessage, type View } from "../context.ts";
import { activeTeamWork, engramLine, HARNESS, harnessNote, taskDependencies, teamSpeaker, teammateMaker, teammateState, type HarnessStatus, type TeamTab } from "../lib/team.ts";
import { relativeTime } from "../lib/time.ts";
import { badge, button, callout, dot, empty, errorState, section, skeletonRows } from "../ui/controls.ts";
import { h, keepPlace, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { renderMarkdown } from "../ui/markdown.ts";
import { workerAvatar } from "../ui/avatar.ts";
import { toast } from "../ui/toast.ts";
import { noteSaid } from "./roster.ts";
import { openConsole } from "./sandboxes.ts";
import { controlTeam, editKnight, editNotes, editRoom, giveTask, provisionVm, remakeVm, removeKnight, setEngram, WORK_TONE } from "./team-forms.ts";

/* The Roundtable's conversations and work belong to the node. Polling only observes them;
 * leaving a room never stops a knight. Unsaved drafts stay in memory, never storage.
 * Who there is to talk to is the roster's (views/roster.ts), beside this page or before it. */
const drafts = new Map<string, string>();
interface WorkspaceStatus {
  workspace: SandboxView | null;
  error?: string;
  harnesses?: HarnessStatus[];
  /** The notes store (Engram): the node's switch, and whether this knight's VM has it. Absent on a node from before it. */
  engram?: TeamEngramStatus;
}

export const teamView: View = (root, ctx, { scope, opts }) => {
  const canEdit = ctx.can("fleet:admin");
  const canChat = canEdit && ctx.can("chat");
  const roomId = opts.room;
  const tab: TeamTab = opts.teamTab ?? "chat";
  let snapshot: TeamSnapshot | null = ctx.live.team.value;
  /** Your prices, for what a finished task cost (asked for once; without them a task still says its tokens). */
  let prices: Record<string, Price> | null = null;
  let room: TeamRoomView | null = null;
  let loading = false;
  let sending = false;
  let previous = "";
  let headVersion = "";
  let chatVersion = "";
  let workspaces = new Map<string, WorkspaceStatus>();
  let workspaceLoading = false;
  let selectedWorkspace = "";

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
  const main = h("section", { class: "team-main", "aria-label": "The Roundtable" }, head, tabs, notice, content, composerWrap);
  replace(root, h("div", { class: "team-layout" }, main));
  replace(content, skeletonRows(4));

  const nameOf = (id: string): string => snapshot?.teammates.find((person) => person.id === id)?.name ?? id;
  /** "made by Galahad", for a worker he (or a worker of his) made; nothing for one of yours. */
  const madeBy = (person: Teammate): string => { const maker = teammateMaker(person, snapshot?.teammates ?? [], snapshot?.removed); return maker ? `made by ${maker}` : ""; };
  const personOf = (id: string): Teammate | undefined => snapshot?.teammates.find((person) => person.id === id);
  const members = (): Teammate[] => (room?.members ?? []).flatMap((id) => { const person = personOf(id); return person ? [person] : []; });
  const avatar = (person: Teammate, live = true, size = 40): SVGSVGElement => workerAvatar({ id: person.id, name: person.name, profile: person.avatar, size, still: !live, expression: live && snapshot ? avatarExpression(person, snapshot, Date.now()) : "idle" });
  const goRoom = (id: string, nextTab: TeamTab = "chat") => ctx.navigate("team", { room: id, teamTab: nextTab });
  const control = (change: Parameters<typeof controlTeam>[1]) => controlTeam(ctx, change);
  const createTask = (copy?: TeamTask) => room && giveTask(ctx, room, copy);
  /** A VM made, or made again: shown at once, and asked about again. */
  const madeVm = (person: Teammate) => (workspace: SandboxView | null) => { workspaces.set(person.id, { workspace }); selectedWorkspace = person.id; void refreshWorkspace(person.id); };

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
      h("a", { class: "btn ghost sm icon-only pane-back", href: "#/team", "aria-label": "The Roundtable", title: "The Roundtable" }, icon("chevron-left", { size: 16 })),
      person ? avatar(person) : h("span", { class: "avatar" }, icon("hash")),
      h("div", { class: "grow" }, h("h2", {}, person?.name ?? currentRoom.name), h("p", { class: "meta ellipsis" }, person ? [person.role, HARNESS[person.harness], state?.text, madeBy(person)].filter(Boolean).join(" · ") : currentRoom.members.map(nameOf).join(" · "))),
      currentRoom.paused ? badge("Paused", "warn") : active.length ? badge(`${active.length} active`, "accent") : null,
      canEdit ? button("Settings", { variant: "ghost", size: "sm", iconOnly: true, icon: "settings", onClick: () => person ? void editKnight(ctx, person) : editRoom(ctx, currentRoom) }) : null,
      canChat ? button(currentRoom.paused ? "Resume room" : "Pause room", { variant: "ghost", size: "sm", iconOnly: true, icon: currentRoom.paused ? "play" : "pause", onClick: () => void control({ room: currentRoom.id, action: currentRoom.paused ? "resume" : "pause" }) }) : null,
      canChat && active.length ? button("Stop room work", { variant: "ghost", size: "sm", iconOnly: true, icon: "stop", onClick: () => void control({ room: currentRoom.id, action: "stop" }) }) : null,
    ));
    keepPlace(tabs, () => replace(tabs, ...(["chat", "work", "workspace"] as TeamTab[]).map((value) => h("button", { class: "team-tab", type: "button", "data-key": `tab:${value}`, "aria-current": tab === value ? "page" : null, onclick: () => goRoom(currentRoom.id, value) }, value === "chat" ? "Conversation" : value === "work" ? `Work${currentRoom.tasks.length ? ` · ${currentRoom.tasks.length}` : ""}` : "Workspace"))));
    composerHint.textContent = currentRoom.paused ? "Room paused · messages are kept" : active.length ? "Busy knights reply when their current work ends" : `Up to ${currentRoom.turnBudget} replies per chain`;
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
          owner ? null : workerAvatar({ id: message.speaker, name: speaker, profile: personOf(message.speaker)?.avatar, still: true }), h("div", { class: "team-message-body" }, h("div", { class: "team-message-by" }, h("strong", {}, speaker), h("time", { datetime: new Date(message.createdAt).toISOString(), title: new Date(message.createdAt).toLocaleString() }, relativeTime(message.createdAt))), h("div", { class: owner ? "team-owner-text" : "md" }, owner ? message.text : renderMarkdown(message.text))));
      }),
      !messages.length ? empty({ icon: "chat", title: room.direct ? `Talk with ${nameOf(room.members[0] ?? "")}` : `Welcome to ${room.name}`, body: room.direct ? "Give your knight a job, share context, or ask a question." : "Give these knights a goal. They can talk to you and each other within this room's reply budget.", compact: true }) : null,
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
      !currentRoom.tasks.length ? empty({ icon: "layers", title: "No assignments yet", body: "Create a task with a clear goal. Choose a knight, add dependencies, and say how the result should be checked.", compact: true }) : null,
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
      // What its run came to, as the runner counted it: its time, commands, tokens, and money at your prices.
      task.record ? h("p", { class: "tiny subtle tnum", title: "Counted by the runner as the task ran" }, taskRecordFacts(task.record, prices ?? {}).join(" · ")) : null,
      // What it changed in its repository, kept to read and to ship (Artifacts opens a pull request from it, on your word).
      task.changes ? h("p", { class: "tiny subtle" }, `${task.changes.files} file${task.changes.files === 1 ? "" : "s"} changed · kept as `, h("a", { href: "#/artifacts", onclick: (e: Event) => { e.preventDefault(); ctx.navigate("artifacts", { intent: task.changes!.artifact }); } }, task.changes.artifact)) : null,
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
    if (!person) { replace(content, empty({ icon: "sandbox", title: "Nobody is in this room", body: "Add knights to it in the room's settings.", compact: true })); return; }
    const known = workspaces.get(person.id);
    const workspace = known?.workspace;
    // (The switch as the team says it now; what this VM has, as it was last asked.)
    const notes = engramLine(known?.engram && snapshot ? { ...known.engram, on: snapshot.engram === true } : known?.engram);
    const chooser = h("select", { class: "select", "aria-label": "Knight's workspace" }, ...people.map((candidate) => h("option", { value: candidate.id, selected: candidate.id === person.id }, candidate.name)));
    chooser.addEventListener("change", () => { selectedWorkspace = chooser.value; renderWorkspace(); void refreshWorkspace(chooser.value); });
    keepPlace(content, () => replace(content, h("div", { class: "team-panel stack loose" },
      h("div", { class: "row between wrap" }, h("h3", {}, `${person.name}'s workspace`), people.length > 1 ? chooser : null),
      h("div", { class: "team-person-summary" }, avatar(person, true, 56), h("div", { class: "grow" }, h("strong", {}, person.name), h("p", { class: "small muted" }, person.instructions || "No instructions yet."), h("div", { class: "meta" }, [HARNESS[person.harness], person.role, `${person.turnsToday}/${person.dailyTurns} turns/jobs today`, madeBy(person)].filter(Boolean).join(" · ")), person.repository ? h("a", { class: "tiny mono", href: person.repository, target: "_blank", rel: "noopener noreferrer" }, person.repository.replace("https://github.com/", "")) : null), canEdit ? button("Edit", { size: "sm", icon: "edit", onClick: () => void editKnight(ctx, person) }) : null),
      h("div", { class: "row wrap" }, canEdit ? button(person.enabled ? "Pause knight" : "Resume knight", { size: "sm", icon: person.enabled ? "pause" : "play", onClick: () => void control({ teammate: person.id, action: person.enabled ? "pause" : "resume" }) }) : null, canEdit ? button("Working notes", { size: "sm", icon: "memory", onClick: () => editNotes(ctx, person) }) : null, canEdit ? button("Room budget", { size: "sm", icon: "settings", onClick: () => room && editRoom(ctx, room) }) : null, canEdit ? button("Remove knight", { size: "sm", variant: "danger", icon: "trash", onClick: () => void removeKnight(ctx, person) }) : null),
      known?.error ? callout("warn", known.error, { title: "Workspace status unavailable", actions: button("Check again", { size: "sm", icon: "refresh", onClick: () => void refreshWorkspace(person.id) }) }) : null,
      workspace ? h("div", { class: "card" }, h("div", { class: "card-body stack" },
        h("div", { class: "row wrap" }, icon("sandbox"), h("strong", {}, workspace.name), badge(workspace.status), badge(workspace.isolation === "vm" ? "MicroVM" : "Container", workspace.isolation === "vm" ? "ok" : "warn")),
        h("p", { class: "small muted" }, `On ${workspace.node} · ${workspace.cpus} CPUs · ${workspace.memoryGb} GB memory · ${workspace.disk ? `${workspace.disk.limitGb} GB disk limit` : "Unlimited disk"} · ${workspace.network}`),
        h("div", { class: "row wrap" }, ctx.can("sandbox") ? button("Open console", { size: "sm", icon: "terminal", onClick: () => openConsole(ctx, workspace, person.workspace?.node ?? null) }) : null, button("Check status", { size: "sm", icon: "refresh", onClick: () => void refreshWorkspace(person.id) }), canEdit ? button("Make VM again", { size: "sm", icon: "retry", onClick: () => remakeVm(ctx, person, workspace, madeVm(person)) }) : null),
      )) : h("div", { class: "team-workspace-empty" }, icon("sandbox", { size: 30 }), h("h3", {}, person.workspace ? "Workspace registered" : "A place to work"),
        h("p", { class: "muted small" }, person.workspace ? `Workspace ${person.workspace.id} on ${person.workspace.node}.${known ? " Its live state couldn't be confirmed." : " Checking its live state…"}` : "Give this knight a persistent VM for code, files and tools. Its job and working notes stay with it."),
        canEdit && ctx.can("sandbox") ? button(person.workspace ? "Check / provision VM" : "Provision VM", { variant: "primary", icon: "plus", onClick: () => provisionVm(ctx, person, madeVm(person)) }) : h("p", { class: "small muted" }, "Provisioning needs fleet:admin and sandbox access on an owner device.")),
      known?.harnesses?.length ? section("Harness readiness", {}, h("div", { class: "card" }, h("div", { class: "rows" }, ...known.harnesses.map((harness) => h("div", { class: "item" }, icon(harness.ready ? "check-circle" : "alert", { size: 16 }), h("div", { class: "grow" }, h("strong", { class: "small" }, HARNESS[harness.id as TeamHarness] ?? harness.id), harnessNote(harness) ? h("p", { class: "meta" }, harnessNote(harness)) : null), badge(harness.ready ? "Ready" : "Unavailable", harness.ready ? "ok" : "warn")))))) : h("p", { class: "small subtle" }, "Harness readiness is checked on the workspace host; choosing one is not proof that it is installed or signed in."),
      notes ? section("Notes store", {}, h("div", { class: "card" }, h("div", { class: "rows" }, h("div", { class: "item" }, icon(notes.tone === "warn" ? "alert" : "memory", { size: 16 }), h("div", { class: "grow" }, h("strong", { class: "small" }, "Engram, for every knight on this node"), h("p", { class: "meta" }, notes.text)), badge(notes.badge, notes.tone), canEdit ? button(notes.badge === "Off" ? "Turn on" : "Turn off", { size: "sm", onClick: () => void setEngram(ctx, notes.badge === "Off").then((changed) => changed && !scope.disposed && void refreshWorkspace(person.id)) }) : null)))) : null,
    )));
  }

  function renderWelcome(): void {
    replace(head); replace(tabs); composerWrap.hidden = true;
    replace(content, h("div", { class: "team-welcome" }, icon("fleet", { size: 36 }), h("h2", {}, snapshot?.teammates.length ? "The Roundtable" : "Seat your first knight"),
      h("p", {}, snapshot?.teammates.length ? "Your knights sit at one table, Galahad first among them. Talk with one directly, bring several into a room, and follow the work." : "Galahad is your primary knight, and the others are his fellows, none beneath him. Give a knight a name, a lasting job and a workspace of its own."),
      canEdit ? h("div", { class: "row wrap" }, button("New knight", { variant: "primary", icon: "plus", onClick: () => void editKnight(ctx) }), snapshot?.teammates.length ? button("New room", { icon: "hash", onClick: () => editRoom(ctx) }) : null) : null,
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

  /** Drawn from the team as the app has it and this conversation as last read; only when something changed. */
  function draw(force = false): void {
    snapshot = ctx.live.team.value;
    if (!snapshot || (roomId && !room)) return;
    const next = snapshot;
    if (!prices && next.tasks.some((task) => task.record)) { prices = {}; void ctx.api.get<{ prices: Record<string, Price> }>("/api/prices", scope.signal).then((result) => { prices = result.prices; draw(true); }, () => {}); }
    notice.hidden = true;
    // A recent completion/failure expression expires even when server state is unchanged.
    const signature = JSON.stringify([next, room, next.teammates.map((person) => avatarExpression(person, next, Date.now()))]);
    if (signature === previous && !force) return;
    renderHead();
    if (!roomId) renderWelcome();
    else if (tab === "chat") renderChat();
    else if (tab === "work") renderWork();
    else renderWorkspace();
    previous = signature;
    if (tab === "workspace" && selectedWorkspace && !workspaces.has(selectedWorkspace)) void refreshWorkspace(selectedWorkspace);
  }

  function failed(error: unknown): void {
    if (scope.disposed || isAbort(error)) return;
    if (!snapshot || (roomId && !room)) replace(content, isUnavailable(error) ? empty({ icon: "fleet", title: "The Roundtable isn't available here", body: "This node doesn't seat knights yet.", actions: button("Try again", { onClick: () => void load(true) }) }) : errorState("Couldn't reach the Roundtable", error, () => void load(true)));
    else { notice.hidden = false; replace(notice, icon("offline", { size: 14 }), h("span", { class: "grow" }, "Updates paused. What you see may be out of date."), button("Retry", { size: "sm", onClick: () => void load(true) })); }
  }

  /** This conversation, read again (and, when asked for at once, the team with it). */
  async function load(force = false): Promise<void> {
    if (force) void ctx.live.refreshTeam();
    if (!roomId || loading || scope.disposed || (!force && document.hidden)) return;
    loading = true;
    try {
      const detail = await ctx.api.post<TeamRoomView>("/api/team/room", { id: roomId }, scope.signal);
      if (scope.disposed) return;
      room = detail;
      noteSaid(detail.id, detail.messages.at(-1));
      draw(force);
    } catch (error) { failed(error); }
    finally { loading = false; }
  }

  input.addEventListener("input", syncComposer);
  input.addEventListener("keydown", (event: KeyboardEvent) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void deliver(); } });
  scope.add(() => { if (roomId && !findSecrets(input.value).length) drafts.set(roomId, input.value); });
  scope.listen(document, "visibilitychange", () => { if (!document.hidden) void load(true); });
  scope.interval(() => void load(), 2000);
  scope.add(ctx.live.team.subscribe(() => draw()));
  scope.add(ctx.live.teamProblem.subscribe((error) => error && failed(error)));
  void load();
  draw();
};
