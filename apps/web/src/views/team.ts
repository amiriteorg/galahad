import type { SandboxView } from "@galahad/core";
import { findSecrets } from "@galahad/core/secret-scan";
import type { TeamEngramStatus, TeamHarness, TeamMessage, TeamRoomView, TeamSnapshot, TeamTask, Teammate } from "@galahad/core/team";
import { TEAM_LIMITS } from "@galahad/core/team-limits";
import type { Price } from "@galahad/core/spend";
import { avatarExpression } from "@galahad/core/avatar";
import { isAbort, isUnavailable } from "../api.ts";
import { errorMessage, type View } from "../context.ts";
import { hasDesktop } from "../lib/desktop.ts";
import type { TaskAction } from "../lib/task-card.ts";
import { activeTeamWork, engramLine, HARNESS, harnessNote, taskDependencies, teamSpeaker, teammateMaker, teammateState, type HarnessStatus } from "../lib/team.ts";
import { giveAgain, timeline, timelineTasks } from "../lib/timeline.ts";
import { relativeTime } from "../lib/time.ts";
import { badge, button, callout, dot, empty, errorState, section, skeletonRows } from "../ui/controls.ts";
import { h, keepPlace, replace, syncChildren } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { renderMarkdown } from "../ui/markdown.ts";
import { workerAvatar } from "../ui/avatar.ts";
import { toast } from "../ui/toast.ts";
import { noteSaid } from "./roster.ts";
import { openConsole } from "./sandboxes.ts";
import { desktopViewer, type DesktopViewer } from "./desktop.ts";
import { liveTrail, type LiveTrail, taskCard } from "./task-card.ts";
import { controlTeam, editKnight, editNotes, editRoom, giveTask, giveToRoundtable, provisionVm, remakeVm, removeKnight, setEngram } from "./team-forms.ts";
import { openTerminal } from "./terminal.ts";

/*
 * A knight, or a room, as one timeline: what was said and the tasks given, in the order they happened, each task a
 * card (views/task-card.ts). A knight's Workspace (its VM, its harnesses, its notes store) is a panel opened from its
 * header. Conversations and work belong to the node: polling only observes them, and leaving never stops a knight.
 * Unsaved drafts stay in memory, never storage. Who there is to talk to is the roster's (views/roster.ts).
 */
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
  const panelAsked = opts.teamTab === "workspace";
  let snapshot: TeamSnapshot | null = ctx.live.team.value;
  /** Your prices, for what a finished task cost (asked for once; without them a task still says its tokens). */
  let prices: Record<string, Price> | null = null;
  let room: TeamRoomView | null = null;
  let loading = false;
  let sending = false;
  let drawn = "";
  let headVersion = "";
  let workspace: WorkspaceStatus | null = null;
  let workspaceLoading = false;
  /** Each item of the timeline as last drawn, by key: one that hasn't changed is handed back as it is. */
  let drawnItems = new Map<string, { version: string; el: HTMLElement }>();
  /** A running task's latest lines, kept across redraws of its card, and let go once it has ended. */
  const trails = new Map<string, LiveTrail>();
  scope.add(() => {
    for (const trail of trails.values()) trail.dispose();
    trails.clear();
  });

  const head = h("header", { class: "team-head" });
  const notice = h("div", { class: "team-notice", role: "status", hidden: true });
  const thread = h("div", { class: "team-thread", "aria-label": "Timeline" });
  const content = h("div", { class: "team-content", tabindex: 0 });
  const status = h("div", { class: "team-live", "aria-live": "polite" });
  const problem = h("div", { class: "team-send-error", role: "status" });
  const input = h("textarea", { rows: 2, maxlength: TEAM_LIMITS.message, placeholder: "Message…", "aria-label": "Message", autocomplete: "off", enterkeyhint: "send" });
  input.value = roomId ? (drafts.get(roomId) ?? "") : "";
  const send = button("Send", { variant: "primary", icon: "arrow-up", type: "submit" });
  // Giving a task (a goal and the commands that prove it) sits beside the message.
  const give = button("Give a task", { size: "sm", icon: "layers", onClick: () => room && giveTask(ctx, room) });
  const composerHint = h("span", { class: "hint grow" });
  const composer = h(
    "form",
    {
      class: "composer",
      onsubmit: (event: Event) => {
        event.preventDefault();
        void deliver();
      },
    },
    input,
    h("div", { class: "composer-bar" }, icon("shield-check", { size: 14, class: "subtle" }), composerHint, give, send),
  );
  const composerWrap = h("div", { class: "team-composer", hidden: true }, status, problem, composer);
  const main = h("section", { class: "team-main", "aria-label": "The Roundtable" }, head, notice, content, composerWrap);
  replace(root, h("div", { class: "team-layout" }, main));
  replace(content, skeletonRows(4));

  const nameOf = (id: string): string => snapshot?.teammates.find((person) => person.id === id)?.name ?? snapshot?.removed?.find((person) => person.id === id)?.name ?? id;
  const roomName = (id: string): string => snapshot?.rooms.find((candidate) => candidate.id === id)?.name ?? id;
  /** "made by Galahad", for a knight he (or another knight) made; nothing for one of yours. */
  const madeBy = (person: Teammate): string => {
    const maker = teammateMaker(person, snapshot?.teammates ?? [], snapshot?.removed);
    return maker ? `made by ${maker}` : "";
  };
  const personOf = (id: string): Teammate | undefined => snapshot?.teammates.find((person) => person.id === id);
  /** The knight whose own conversation this is (none: a room). */
  const knight = (): Teammate | undefined => (room?.direct && room.members.length === 1 ? personOf(room.members[0]!) : undefined);
  const panelOpen = (): boolean => panelAsked && Boolean(knight());
  const avatar = (person: Teammate, live = true, size = 40): SVGSVGElement =>
    workerAvatar({ id: person.id, name: person.name, profile: person.avatar, size, still: !live, expression: live && snapshot ? avatarExpression(person, snapshot, Date.now()) : "idle" });
  const control = (change: Parameters<typeof controlTeam>[1]) => controlTeam(ctx, change);
  const showPanel = (open: boolean) => roomId && ctx.navigate("team", { room: roomId, ...(open ? { teamTab: "workspace" as const } : {}) });
  /** A VM made, or made again: shown at once, and asked about again. */
  const madeVm = (person: Teammate) => (made: SandboxView | null) => {
    workspace = { workspace: made };
    draw(true);
    void refreshWorkspace(person.id);
  };

  function renderHead(): void {
    if (!room) {
      replace(head);
      return;
    }
    const current = room;
    const person = knight();
    const active = [...current.tasks, ...current.deliveries].filter(activeTeamWork);
    const state = person && snapshot ? teammateState(person, snapshot) : null;
    const open = panelOpen();
    const version = JSON.stringify([current.id, current.name, current.members.map((id) => [id, nameOf(id)]), current.paused, person, state?.text, active.map((job) => [job.id, job.status]), person && snapshot ? avatarExpression(person, snapshot, Date.now()) : null, open]);
    if (version === headVersion) return;
    headVersion = version;
    const toggle = button("Workspace", { size: "sm", icon: "sandbox", label: open ? "Close the workspace" : "Workspace", onClick: () => showPanel(!open) });
    toggle.classList.add("workspace-toggle");
    toggle.setAttribute("aria-pressed", String(open));
    keepPlace(head, () =>
      replace(
        head,
        h("a", { class: "btn ghost sm icon-only pane-back", href: "#/team", "aria-label": "The Roundtable", title: "The Roundtable" }, icon("chevron-left", { size: 16 })),
        person ? avatar(person) : h("span", { class: "avatar" }, icon("hash")),
        h("div", { class: "grow" }, h("h2", {}, person?.name ?? current.name), h("p", { class: "meta ellipsis" }, person ? [person.role, state?.text, madeBy(person)].filter(Boolean).join(" · ") : current.members.map(nameOf).join(" · "))),
        current.paused ? badge("Paused", "warn") : null,
        person ? toggle : null,
        !person && canEdit ? button("Room settings", { variant: "ghost", size: "sm", iconOnly: true, icon: "settings", onClick: () => editRoom(ctx, current) }) : null,
        !person && canChat ? button(current.paused ? "Resume room" : "Pause room", { variant: "ghost", size: "sm", iconOnly: true, icon: current.paused ? "play" : "pause", onClick: () => void control({ room: current.id, action: current.paused ? "resume" : "pause" }) }) : null,
        !person && canChat && active.length ? button("Stop the room's work", { variant: "ghost", size: "sm", iconOnly: true, icon: "stop", onClick: () => void control({ room: current.id, action: "stop" }) }) : null,
      ),
    );
    composerHint.textContent = current.paused ? "Paused · messages are kept" : active.length ? (person ? "Replies when its work ends" : "A busy knight replies when free") : `Up to ${current.turnBudget} replies a chain`;
    input.placeholder = `Message ${person?.name ?? current.name}…`;
    input.setAttribute("aria-label", `Message ${person?.name ?? current.name}`);
    const writing = current.deliveries.filter((delivery) => activeTeamWork(delivery));
    replace(status, ...writing.map((delivery) => h("span", { class: "row" }, dot(delivery.status === "running" ? "accent" : "neutral", { live: delivery.status === "running" }), `${nameOf(delivery.teammate)} ${delivery.status === "running" ? "is writing" : "replies when free"}`)));
    syncComposer();
  }

  function messageEl(message: TeamMessage): HTMLElement {
    const speaker = teamSpeaker(message, snapshot?.teammates ?? []);
    const at = h("time", { datetime: new Date(message.createdAt).toISOString(), title: new Date(message.createdAt).toLocaleString() }, relativeTime(message.createdAt));
    if (message.speaker === "system") return h("div", { class: "team-system", "data-key": message.id }, icon("activity", { size: 13 }), h("span", {}, message.text), at);
    const owner = message.speaker === "owner";
    return h(
      "article",
      { class: `team-message${owner ? " owner" : ""}`, "data-key": message.id, "aria-label": `${speaker} said` },
      owner ? null : workerAvatar({ id: message.speaker, name: speaker, profile: personOf(message.speaker)?.avatar, still: true }),
      h("div", { class: "team-message-body" }, h("div", { class: "team-message-by" }, h("strong", {}, speaker), at), h("div", { class: owner ? "team-owner-text" : "md" }, owner ? message.text : renderMarkdown(message.text))),
    );
  }

  function act(task: TeamTask, action: TaskAction): void {
    if (action === "again") {
      const where = snapshot?.rooms.find((candidate) => candidate.id === task.room) ?? room;
      if (where) giveTask(ctx, where, giveAgain(task));
    } else void control({ task: task.id, action });
  }

  function taskEl(task: TeamTask): HTMLElement {
    let trail = trails.get(task.id) ?? null;
    if (task.status === "running" && !trail) {
      // Its end is heard here first: the team and this conversation are asked for again, and its card becomes an ended one.
      trail = liveTrail(ctx.api, task.id, content, () => void load(true));
      trails.set(task.id, trail);
    }
    return taskCard(ctx, task, {
      room: room!.id,
      roomName,
      assignee: room!.direct ? null : nameOf(task.assignee),
      dependencies: taskDependencies(task, snapshot?.tasks ?? []),
      prices,
      canAct: canChat,
      signal: scope.signal,
      trail: task.status === "running" ? trail : null,
      act: (action) => act(task, action),
    });
  }

  /** What a task's card shows, so that one whose card would look the same is not drawn again (its trail runs on). */
  const taskVersion = (task: TeamTask): string =>
    JSON.stringify([task.status, task.verified, task.title, task.goal, task.gates, task.error, task.output, task.record, task.changes, task.givenBy, roomName(task.room), nameOf(task.assignee), taskDependencies(task, snapshot?.tasks ?? []), Boolean(prices), relativeTime(task.status === "queued" || task.status === "running" ? task.createdAt : task.updatedAt)]);

  function renderTimeline(): void {
    if (!room || !snapshot) return;
    const current = room;
    const tasks = timelineTasks(current, snapshot.tasks);
    // (Only the latest words of a long conversation come from the node: the timeline begins where they do.)
    const since = current.messages.length >= TEAM_LIMITS.history ? current.messages[0]?.createdAt : undefined;
    const items = timeline(current.messages, tasks, since === undefined ? {} : { since });
    const running = new Set(items.flatMap((item) => (item.kind === "task" && item.task.status === "running" ? [item.task.id] : [])));
    for (const [id, trail] of trails) {
      if (running.has(id)) continue;
      trail.dispose();
      trails.delete(id);
    }
    const next = new Map<string, { version: string; el: HTMLElement }>();
    const els = items.map((item) => {
      const version = item.kind === "message" ? JSON.stringify([item.message.text, teamSpeaker(item.message, snapshot!.teammates), personOf(item.message.speaker)?.avatar, relativeTime(item.message.createdAt)]) : taskVersion(item.task);
      const had = drawnItems.get(item.key);
      const el = had?.version === version ? had.el : item.kind === "message" ? messageEl(item.message) : taskEl(item.task);
      next.set(item.key, { version, el });
      return el;
    });
    drawnItems = next;
    const first = content.firstChild !== thread;
    const nearEnd = content.scrollHeight - content.scrollTop - content.clientHeight < 120;
    const person = knight();
    syncChildren(
      thread,
      els.length
        ? els
        : [
            empty({
              icon: "chat",
              title: person ? `Talk with ${person.name}` : `Welcome to ${current.name}`,
              body: person ? `Give ${person.name} a job, share context, or ask a question. A task you give it is a card here, from its first line to what it kept.` : "Give these knights a goal. They can talk to you and each other within this room's reply budget.",
              compact: true,
            }),
          ],
    );
    if (first) replace(content, thread);
    if (first || nearEnd) content.scrollTop = content.scrollHeight;
  }

  async function refreshWorkspace(id: string): Promise<void> {
    if (workspaceLoading || !ctx.can("sandbox")) return;
    workspaceLoading = true;
    try {
      const result = await ctx.api.post<WorkspaceStatus>("/api/team/workspace", { id }, scope.signal);
      if (scope.disposed) return;
      workspace = result;
    } catch (error) {
      if (!isAbort(error)) workspace = { workspace: null, error: errorMessage(error) };
    } finally {
      workspaceLoading = false;
      if (!scope.disposed && panelOpen()) draw(true);
    }
  }

  /** The Workspace panel, made once: what is above the desktop and below it is drawn again as it changes, the desktop never. */
  let panel: { top: HTMLElement; slot: HTMLElement; bottom: HTMLElement } | null = null;
  let viewer: DesktopViewer | null = null;
  scope.add(() => viewer?.dispose());

  function renderPanel(): void {
    const person = knight()!;
    const known = workspace;
    const vm = known?.workspace;
    // (The switch as the team says it now; what this VM has, as it was last asked.)
    const notes = engramLine(known?.engram && snapshot ? { ...known.engram, on: snapshot.engram === true } : known?.engram);
    if (!panel) {
      // (Its desktop, when it has one, first: the screen is what the panel is opened to see.)
      panel = { top: h("div", { class: "stack loose" }), slot: h("div", { class: "desktop-slot" }), bottom: h("div", { class: "stack loose" }) };
      const head = h("div", { class: "row between" }, h("h3", {}, "Workspace"), button("Back to the timeline", { variant: "ghost", size: "sm", iconOnly: true, icon: "x", onClick: () => showPanel(false) }));
      replace(content, h("div", { class: "team-panel stack loose", "aria-label": `${person.name}'s workspace` }, head, panel.slot, panel.top, panel.bottom));
    }
    // Its desktop, while its VM runs with one and this device may look: watched from here, and taken over.
    const desktop = Boolean(vm && hasDesktop(vm) && vm.status === "running" && ctx.can("sandbox"));
    if (desktop && !viewer) {
      viewer = desktopViewer(ctx, person, content, canEdit ? () => remakeVm(ctx, person, vm!, madeVm(person), { desktop: true }) : null);
      replace(panel.slot, viewer.el);
    } else if (!desktop && viewer) {
      viewer.dispose();
      viewer = null;
      replace(panel.slot);
    }
    const { top, bottom } = panel;
    keepPlace(top, () =>
      replace(
        top,
        h(
          "div",
          { class: "team-person-summary" },
          avatar(person, true, 56),
          h(
            "div",
            { class: "grow" },
            h("strong", {}, person.name),
            h("p", { class: "small muted" }, person.instructions || "No instructions yet."),
            h("div", { class: "meta" }, [HARNESS[person.harness], person.role, `${person.turnsToday}/${person.dailyTurns} turns/jobs today`, madeBy(person)].filter(Boolean).join(" · ")),
            person.repository ? h("a", { class: "tiny mono", href: person.repository, target: "_blank", rel: "noopener noreferrer" }, person.repository.replace("https://github.com/", "")) : null,
          ),
          canEdit ? button("Edit", { size: "sm", icon: "edit", onClick: () => void editKnight(ctx, person) }) : null,
        ),
        canEdit
          ? h(
              "div",
              { class: "row wrap" },
              button(person.enabled ? "Pause knight" : "Resume knight", { size: "sm", icon: person.enabled ? "pause" : "play", onClick: () => void control({ teammate: person.id, action: person.enabled ? "pause" : "resume" }) }),
              button("Working notes", { size: "sm", icon: "memory", onClick: () => editNotes(ctx, person) }),
              button("Remove knight", { size: "sm", variant: "danger", icon: "trash", onClick: () => void removeKnight(ctx, person) }),
            )
          : null,
        known?.error ? callout("warn", known.error, { title: "Workspace status unavailable", actions: button("Check again", { size: "sm", icon: "refresh", onClick: () => void refreshWorkspace(person.id) }) }) : null,
        vm
          ? h(
              "div",
              { class: "card" },
              h(
                "div",
                { class: "card-body stack" },
                h("div", { class: "row wrap" }, icon("sandbox"), h("strong", {}, vm.name), badge(vm.status), badge(vm.isolation === "vm" ? "MicroVM" : "Container", vm.isolation === "vm" ? "ok" : "warn"), hasDesktop(vm) ? badge("Desktop", "neutral", "monitor") : badge("No desktop")),
                h("p", { class: "small muted" }, `On ${vm.node} · ${vm.cpus} CPUs · ${vm.memoryGb} GB memory · ${vm.disk ? `${vm.disk.limitGb} GB disk limit` : "Unlimited disk"} · ${vm.network}`),
                h(
                  "div",
                  { class: "row wrap" },
                  // A real terminal where the VM is on the node you are talking to (terminals aren't forwarded); else the console.
                  ctx.can("sandbox") ? (person.workspace?.node === ctx.whoami.node ? button("Open terminal", { size: "sm", icon: "terminal", onClick: () => void openTerminal(ctx, { id: vm.id, name: `${person.name}'s VM` }) }) : button("Open console", { size: "sm", icon: "terminal", onClick: () => openConsole(ctx, vm, person.workspace?.node ?? null) })) : null,
                  button("Check status", { size: "sm", icon: "refresh", onClick: () => void refreshWorkspace(person.id) }),
                  canEdit ? button("Make VM again", { size: "sm", icon: "retry", onClick: () => remakeVm(ctx, person, vm, madeVm(person)) }) : null,
                ),
              ),
            )
          : h(
              "div",
              { class: "team-workspace-empty" },
              icon("sandbox", { size: 30 }),
              h("h3", {}, person.workspace ? "Workspace registered" : "A place to work"),
              h("p", { class: "muted small" }, person.workspace ? `Workspace ${person.workspace.id} on ${person.workspace.node}.${!ctx.can("sandbox") ? " Its live state is shown to a device that may manage sandboxes." : known ? " Its live state couldn't be confirmed." : " Checking its live state…"}` : "Give this knight a persistent VM for code, files and tools. Its job and working notes stay with it."),
              canEdit && ctx.can("sandbox") ? button(person.workspace ? "Check / provision VM" : "Provision VM", { variant: "primary", icon: "plus", onClick: () => provisionVm(ctx, person, madeVm(person)) }) : h("p", { class: "small muted" }, "Provisioning needs fleet:admin and sandbox access on an owner device."),
            ),
      ),
    );
    keepPlace(bottom, () =>
      replace(
        bottom,
        known?.harnesses?.length
          ? section(
              "Harness readiness",
              {},
              h(
                "div",
                { class: "card" },
                h("div", { class: "rows" }, ...known.harnesses.map((harness) => h("div", { class: "item" }, icon(harness.ready ? "check-circle" : "alert", { size: 16 }), h("div", { class: "grow" }, h("strong", { class: "small" }, HARNESS[harness.id as TeamHarness] ?? harness.id), harnessNote(harness) ? h("p", { class: "meta" }, harnessNote(harness)) : null), badge(harness.ready ? "Ready" : "Unavailable", harness.ready ? "ok" : "warn")))),
              ),
            )
          : h("p", { class: "small subtle" }, "Harness readiness is checked on the workspace host; choosing one is not proof that it is installed or signed in."),
        notes
          ? section(
              "Notes store",
              {},
              h(
                "div",
                { class: "card" },
                h(
                  "div",
                  { class: "rows" },
                  h(
                    "div",
                    { class: "item" },
                    icon(notes.tone === "warn" ? "alert" : "memory", { size: 16 }),
                    h("div", { class: "grow" }, h("strong", { class: "small" }, "Engram, for every knight on this node"), h("p", { class: "meta" }, notes.text)),
                    badge(notes.badge, notes.tone),
                    canEdit ? button(notes.badge === "Off" ? "Turn on" : "Turn off", { size: "sm", onClick: () => void setEngram(ctx, notes.badge === "Off").then((changed) => changed && !scope.disposed && void refreshWorkspace(person.id)) }) : null,
                  ),
                ),
              ),
            )
          : null,
      ),
    );
  }

  function renderWelcome(): void {
    replace(head);
    composerWrap.hidden = true;
    replace(
      content,
      h(
        "div",
        { class: "team-welcome" },
        icon("fleet", { size: 36 }),
        h("h2", {}, snapshot?.teammates.length ? "The Roundtable" : "Seat your first knight"),
        h("p", {}, snapshot?.teammates.length ? "Your knights sit at one table, Galahad first among them. Give a task to the Roundtable and the knight best suited to it takes it, and says why; or talk with one directly, and bring several into a room." : "Galahad is your primary knight, and the others are his fellows, none beneath him. Give a knight a name, a lasting job and a workspace of its own."),
        canEdit
          ? h(
              "div",
              { class: "row wrap" },
              snapshot?.teammates.length ? button("Give a task", { variant: "primary", icon: "layers", onClick: () => giveToRoundtable(ctx) }) : null,
              button("New knight", { variant: snapshot?.teammates.length ? "default" : "primary", icon: "plus", onClick: () => void editKnight(ctx) }),
              snapshot?.teammates.length ? button("New room", { icon: "hash", onClick: () => editRoom(ctx) }) : null,
            )
          : null,
      ),
    );
  }

  function syncComposer(): void {
    const secret = findSecrets(input.value).length > 0;
    send.disabled = sending || !input.value.trim() || secret || !room;
    give.hidden = !room;
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
      if (input.value.trim() === text) {
        input.value = "";
        drafts.delete(room.id);
      }
      await load(true);
      content.scrollTop = content.scrollHeight;
    } catch (error) {
      if (!isAbort(error)) toast("Message wasn't sent", { tone: "error", description: errorMessage(error) });
    } finally {
      sending = false;
      if (!scope.disposed) syncComposer();
    }
  }

  /** Drawn from the team as the app has it and this conversation as last read; only when something changed. */
  function draw(force = false): void {
    snapshot = ctx.live.team.value;
    if (!snapshot) return;
    if (!roomId) return renderWelcome();
    if (!room) return;
    const next = snapshot;
    if (!prices && next.tasks.some((task) => task.record)) {
      prices = {};
      void ctx.api.get<{ prices: Record<string, Price> }>("/api/prices", scope.signal).then(
        (result) => {
          prices = result.prices;
          draw(true);
        },
        () => {},
      );
    }
    notice.hidden = true;
    // A face that was pleased for a moment changes back by itself, and "2 min ago" moves on: both are drawn again.
    const signature = JSON.stringify([next, room, workspace, next.teammates.map((person) => avatarExpression(person, next, Date.now())), Math.floor(Date.now() / 60_000)]);
    if (signature === drawn && !force) return;
    drawn = signature;
    renderHead();
    composerWrap.hidden = !canChat || panelOpen();
    if (panelOpen()) {
      renderPanel();
      if (!workspace) void refreshWorkspace(knight()!.id);
    } else renderTimeline();
  }

  function failed(error: unknown): void {
    if (scope.disposed || isAbort(error)) return;
    if (!snapshot || (roomId && !room)) replace(content, isUnavailable(error) ? empty({ icon: "fleet", title: "The Roundtable isn't available here", body: "This node doesn't seat knights yet.", actions: button("Try again", { onClick: () => void load(true) }) }) : errorState("Couldn't reach the Roundtable", error, () => void load(true)));
    else {
      notice.hidden = false;
      replace(notice, icon("offline", { size: 14 }), h("span", { class: "grow" }, "Updates paused. What you see may be out of date."), button("Retry", { size: "sm", onClick: () => void load(true) }));
    }
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
    } catch (error) {
      failed(error);
    } finally {
      loading = false;
    }
  }

  input.addEventListener("input", syncComposer);
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void deliver();
    }
  });
  scope.add(() => {
    if (roomId && !findSecrets(input.value).length) drafts.set(roomId, input.value);
  });
  scope.listen(document, "visibilitychange", () => {
    if (!document.hidden) void load(true);
  });
  scope.interval(() => void load(), 2000);
  scope.add(ctx.live.team.subscribe(() => draw()));
  scope.add(ctx.live.teamProblem.subscribe((error) => error && failed(error)));
  void load();
  draw();
};
