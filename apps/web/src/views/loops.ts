import type { ConnectorView, FindingView, LoopRunView, LoopTask, LoopView, SelfActionView } from "@galahad/core";
import { findSecrets } from "@galahad/core/secret-scan";
import { type Ctx, errorMessage, type View } from "../context.ts";
import { gatesFromText } from "../lib/quests.ts";
import { describeSchedule, scheduleProblem } from "../lib/schedule.ts";
import { shortId } from "../lib/text.ts";
import { absoluteTime, duration, relativeTime } from "../lib/time.ts";
import type { NetworkMode } from "../types.ts";
import { badge, busy, button, callout, empty, errorState, field, pageHead, section, segmented, skeletonBlock, skeletonRows, switchControl, type Tone } from "../ui/controls.ts";
import { confirmAction, openSheet } from "../ui/dialog.ts";
import { type Child, h, keepPlace, nextId, replace } from "../ui/dom.ts";
import { icon, type IconName } from "../ui/icons.ts";
import { signal } from "../ui/signal.ts";
import { toast } from "../ui/toast.ts";
import { deviceName } from "./activity.ts";
import { argFields, type ArgsRead, classNote, loadConnectors } from "./connectors.ts";
import { NETWORK } from "./sandboxes.ts";

/*
 * Loops: work Galahad does on a schedule ("every 30m", or a cron line in a time
 * zone). Each lives in the mind, so every device sees it and its history, and
 * names exactly one node that runs it, so it never runs twice. A node that was
 * away runs a missed loop once; a run cut short by a crash is recorded as
 * interrupted and never repeated. A loop that calls an outward tool never sends
 * on its own: each run files a request in your Inbox.
 */

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
/** A run started by hand stops being watched after this long (its result still lands in the history). */
const WATCH_MS = 30 * 60_000;

/** Bumped whenever a loop is added, changed or removed here. */
export const loopsChanged = signal(0);

export const RUN_STATUS: Record<LoopRunView["status"], { label: string; tone: Tone; icon: IconName }> = {
  ok: { label: "ok", tone: "ok", icon: "check-circle" },
  attention: { label: "needs a look", tone: "warn", icon: "alert" },
  failed: { label: "failed", tone: "danger", icon: "x-circle" },
  interrupted: { label: "interrupted", tone: "warn", icon: "stop" },
};

export const SEVERITY: Record<FindingView["severity"], { label: string; tone: Tone; icon: IconName }> = {
  alert: { label: "alert", tone: "danger", icon: "alert" },
  warn: { label: "warning", tone: "warn", icon: "alert" },
  info: { label: "info", tone: "info", icon: "info" },
};

const KIND: Record<LoopTask["kind"], { label: string; icon: IconName }> = {
  heartbeat: { label: "Heartbeat", icon: "activity" },
  quest: { label: "Quest", icon: "compass" },
  call: { label: "Connector", icon: "plug" },
};

const PRESETS: { label: string; schedule: string }[] = [
  { label: "Every 30 min", schedule: "every 30m" },
  { label: "Hourly", schedule: "0 * * * *" },
  { label: "Daily 07:00", schedule: "0 7 * * *" },
  { label: "Weekdays 07:00", schedule: "0 7 * * 1-5" },
];

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const firstLine = (text: string) => clip(text.split("\n")[0]?.trim() ?? "", 200);

export function describeTask(task: LoopTask | null): string {
  if (!task) return "A task this node can't read.";
  if (task.kind === "heartbeat") {
    const what = task.checklist ? "Heartbeat: checks the fleet, then reads your checklist." : "Heartbeat: checks the fleet and the machine it runs on.";
    return `${what}${task.selfAction === false ? " Only reports: self-action is off." : " Then fixes what's safe himself."}`;
  }
  if (task.kind === "quest") {
    const gates = task.gates?.length ? ` Done means ${task.gates.length === 1 ? "this passes" : `these ${task.gates.length} pass`}: ${clip(task.gates.join(" · "), 160)}` : "";
    return `Quest, ${NETWORK[task.network]?.label.toLowerCase() ?? task.network}: ${clip(task.goal, 160)}${gates}`;
  }
  const args = Object.entries(task.args ?? {}).map(([k, v]) => `${k}=${String(v)}`).join(" ");
  return `Calls ${task.connector}.${task.tool}${args ? ` ${clip(args, 120)}` : ""}`;
}

/** A heartbeat finding or a notice: what, how serious, about which machine. */
export function findingRow(ctx: Ctx, f: { severity: FindingView["severity"]; title: string; body: string; node?: string | null }, meta: Child = null, actions: Child = null): HTMLElement {
  const sev = SEVERITY[f.severity] ?? SEVERITY.info;
  return h(
    "div",
    { class: "item" },
    h("span", { class: "avatar", "data-tone": sev.tone }, icon(sev.icon, { size: 16, label: sev.label })),
    h(
      "div",
      { class: "grow" },
      h("div", { class: "strong" }, f.title),
      f.body ? h("p", { class: "small muted wrap-anywhere" }, f.body) : null,
      f.node || meta ? h("div", { class: "meta" }, f.node ? h("span", {}, `about ${deviceName(ctx, f.node)}`) : null, meta) : null,
    ),
    actions ? h("div", { class: "item-actions" }, actions) : null,
  );
}

function timeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return ["UTC"];
  }
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function knownZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Add a loop, or change one (its name stays). */
export function openLoopSheet(ctx: Ctx, existing?: LoopView): void {
  if (!ctx.can("brain:write")) {
    toast("This device can't change loops", { tone: "warn", description: "It was paired without the brain:write scope." });
    return;
  }
  const task0 = existing?.task ?? null;
  const name = h("input", {
    class: "input mono",
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
    autocapitalize: "off",
    maxlength: 40,
    placeholder: "e.g. morning",
    value: existing?.name ?? "",
    disabled: Boolean(existing),
  });
  const label = h("input", { class: "input", type: "text", autocomplete: "off", maxlength: 128, placeholder: "e.g. Morning briefing", value: existing?.label ?? "" });

  // When
  const schedule = h("input", { class: "input mono", type: "text", autocomplete: "off", spellcheck: "false", autocapitalize: "off", maxlength: 128, value: existing?.schedule ?? "every 30m" });
  const zones = h("datalist", { id: nextId("zones") }, ...timeZones().map((z) => h("option", { value: z })));
  const tz = h("input", { class: "input", type: "text", list: zones.id, autocomplete: "off", spellcheck: "false", autocapitalize: "off", maxlength: 64, value: existing?.tz ?? browserZone() });
  const preview = h("span", { "aria-live": "polite" });
  const presetChips = PRESETS.map((preset) => {
    const chip = h("button", { class: "chip", type: "button", "aria-pressed": "false" }, preset.label);
    chip.addEventListener("click", () => {
      schedule.value = preset.schedule;
      syncSchedule();
    });
    return { chip, preset };
  });
  function syncSchedule(): void {
    const text = schedule.value.trim().replace(/\s+/g, " ");
    for (const { chip, preset } of presetChips) chip.setAttribute("aria-pressed", String(text === preset.schedule));
    const words = describeSchedule(text);
    const problem = text ? scheduleProblem(text) : null;
    preview.textContent = problem ?? (words ? `${words}, ${tz.value.trim() || "UTC"} time.` : "A cron line: minute, hour, day of month, month, day of week.");
  }
  schedule.addEventListener("input", syncSchedule);
  tz.addEventListener("input", syncSchedule);

  // Where
  const nodes = (ctx.live.fleet.value?.devices ?? []).filter((d) => d.kind === "node" && d.role === "full" && !d.revokedAt).sort((a, b) => a.name.localeCompare(b.name));
  const where = h(
    "select",
    { class: "select" },
    existing ? null : h("option", { value: "" }, "Galahad chooses"),
    existing && !nodes.some((n) => n.id === existing.on) ? h("option", { value: existing.on, selected: true }, `${existing.onName ?? shortId(existing.on)} (unavailable)`) : null,
    ...nodes.map((n) => h("option", { value: n.id, selected: n.id === existing?.on }, n.name)),
  );

  // What
  let kind: LoopTask["kind"] = task0?.kind ?? "heartbeat";
  const checklist = h("textarea", { class: "textarea", rows: 4, maxlength: 4000, placeholder: "e.g. Is the backup from last night there? Any CI failures on main?" });
  if (task0?.kind === "heartbeat" && task0.checklist) checklist.value = task0.checklist;
  const heartbeatPanel = h(
    "div",
    { class: "stack" },
    h(
      "p",
      { class: "small muted" },
      "Checks the fleet and the machine it runs on: silent servers, a locked vault, roles without a usable model, overdue sandboxes, failing loops, connector keys, disk. What it finds becomes a notice in your Inbox, and clears itself when it's fixed.",
    ),
    field("Your checklist (optional)", checklist, { hint: "Plain words, read each run by the swift role. It answers all clear, or with a short note." }),
  );

  const goal = h("textarea", { class: "textarea", rows: 4, maxlength: 4000, placeholder: "e.g. Read the open issues in amiriteorg/galahad and summarise what changed this week." });
  let network: NetworkMode = task0?.kind === "quest" ? task0.network : "isolated";
  if (task0?.kind === "quest") goal.value = task0.goal;
  const netExplain = h("div");
  const syncNet = () =>
    replace(netExplain, h("div", { class: "net-explain", "data-tone": NETWORK[network].tone }, icon(NETWORK[network].icon, { size: 16 }), h("div", {}, h("strong", {}, NETWORK[network].label), ". ", NETWORK[network].explain)));
  const networkControl = segmented(
    (Object.keys(NETWORK) as NetworkMode[]).map((mode) => ({ value: mode, label: NETWORK[mode].label, icon: NETWORK[mode].icon, tone: NETWORK[mode].color })),
    network,
    (value) => {
      network = value;
      syncNet();
    },
    { label: "Network", block: true },
  );
  syncNet();
  // Gates: "done means this command passes", one shell command a line.
  const gatesField = h("textarea", { class: "textarea mono", rows: 2, spellcheck: false, autocapitalize: "off", autocomplete: "off", placeholder: "e.g. test -s /work/out/summary.md" });
  if (task0?.kind === "quest" && task0.gates?.length) gatesField.value = task0.gates.join("\n");
  const questPanel = h(
    "div",
    { class: "stack" },
    field("Goal", goal, { hint: "Each run is a fresh quest in its own sandbox: plan, work, an independent review, remembered." }),
    field("Gates (optional)", gatesField, {
      hint: "Done means these pass: one shell command a line, run in the quest's sandbox when the engineer says he's done. Every one must exit 0 before the reviewer is asked; a run whose gates never pass is never done.",
    }),
    h("div", { class: "stack tight" }, h("div", { class: "label" }, "Network"), networkControl.el, netExplain),
  );

  const connectorSelect = h("select", { class: "select" }, h("option", { value: "" }, "Loading connectors…"));
  const toolSelect = h("select", { class: "select" });
  const argsBox = h("div");
  const toolNote = h("div");
  const callFields = h("div", { class: "stack" }, h("div", { class: "fields" }, field("Connector", connectorSelect), field("Tool", toolSelect)), toolNote, argsBox);
  const callPanel = h("div", { class: "stack" }, callFields);
  let installed: ConnectorView[] = [];
  let args: { read(): ArgsRead } | null = null;
  const initialCall = task0?.kind === "call" ? task0 : null;

  function syncTools(keepTool?: string): void {
    const c = installed.find((x) => x.id === connectorSelect.value);
    replace(toolSelect, ...(c ? c.tools.map((t) => h("option", { value: t.name, selected: t.name === keepTool }, `${t.name}${t.asks ? " (asks you)" : ""}`)) : [h("option", { value: "" }, "Choose a connector first")]));
    syncArgs();
  }
  function syncArgs(initial: Record<string, unknown> = {}): void {
    const tool = installed.find((x) => x.id === connectorSelect.value)?.tools.find((t) => t.name === toolSelect.value);
    if (!tool) {
      args = null;
      replace(argsBox);
      replace(toolNote);
      return;
    }
    const form = argFields(tool, initial);
    args = form;
    replace(toolNote, h("p", { class: "small muted" }, tool.description), classNote(tool.class, "loop"));
    replace(argsBox, form.el);
  }
  connectorSelect.addEventListener("change", () => syncTools());
  toolSelect.addEventListener("change", () => syncArgs());

  const panels: Record<LoopTask["kind"], HTMLElement> = { heartbeat: heartbeatPanel, quest: questPanel, call: callPanel };
  const showKind = () => {
    for (const [k, panel] of Object.entries(panels)) panel.hidden = k !== kind;
  };
  const kindControl = segmented(
    (Object.keys(KIND) as LoopTask["kind"][]).map((k) => ({ value: k, label: KIND[k].label, icon: KIND[k].icon })),
    kind,
    (value) => {
      kind = value;
      showKind();
    },
    { label: "What it does", block: true },
  );
  showKind();

  function buildTask(): { task: LoopTask } | { problem: string; focus?: HTMLElement } {
    if (kind === "heartbeat") {
      const text = checklist.value.trim();
      // The self-action switch is its own control (on the Loops page); a changed heartbeat keeps it.
      const off = task0?.kind === "heartbeat" && task0.selfAction === false;
      return { task: { kind: "heartbeat", ...(text ? { checklist: text } : {}), ...(off ? { selfAction: false } : {}) } };
    }
    if (kind === "quest") {
      const text = goal.value.trim();
      if (!text) return { problem: "Give the quest a goal.", focus: goal };
      const maxSteps = task0?.kind === "quest" ? task0.maxSteps : undefined;
      const typed = gatesFromText(gatesField.value);
      if ("problem" in typed) return { problem: typed.problem, focus: gatesField };
      return { task: { kind: "quest", goal: text, network, ...(maxSteps ? { maxSteps } : {}), ...(typed.gates.length ? { gates: typed.gates } : {}) } };
    }
    if (!connectorSelect.value) return { problem: "Choose a connector.", focus: connectorSelect };
    if (!toolSelect.value || !args) return { problem: "Choose a tool.", focus: toolSelect };
    const read = args.read();
    if ("problem" in read) return read;
    return { task: { kind: "call", connector: connectorSelect.value, tool: toolSelect.value, args: read.args } };
  }

  const status = h("div");
  const save = button(existing ? "Save loop" : "Add loop", { variant: "primary", type: "submit", icon: "check" });
  const stop = (problem: string, focus?: HTMLElement) => {
    replace(status, callout("warn", problem));
    focus?.focus();
  };
  const form = h(
    "form",
    {
      class: "stack loose",
      autocomplete: "off",
      onsubmit: (event: Event) => {
        event.preventDefault();
        replace(status);
        const loopName = existing?.name ?? name.value.trim();
        if (!NAME_RE.test(loopName)) return stop("Name it with lowercase letters, digits, . _ or - (up to 40), starting with a letter or digit.", name);
        const when = schedule.value.trim().replace(/\s+/g, " ");
        const problem = scheduleProblem(when);
        if (problem) return stop(problem, schedule);
        const zone = tz.value.trim() || "UTC";
        if (!knownZone(zone)) return stop(`"${zone}" isn't a time zone. Use a name such as Europe/Copenhagen, or UTC.`, tz);
        // Loops are shared in plaintext and their words reach models: no keys in them.
        for (const input of [label, checklist, goal, gatesField]) {
          if (!findSecrets(input.value).length) continue;
          input.value = "";
          return stop("That looked like a key, so the field was cleared. Loops are shared in plaintext and their words reach models; keys belong in the vault.", input);
        }
        const built = buildTask();
        if ("problem" in built) return stop(built.problem, built.focus);
        const body = {
          name: loopName,
          schedule: when,
          tz: zone,
          task: built.task,
          label: label.value.trim(),
          ...(where.value && where.value !== existing?.on ? { on: where.value } : {}),
        };
        void busy(save, async () => {
          try {
            const { loop } = await ctx.api.post<{ loop: LoopView }>("/api/loops", body);
            sheet.close();
            loopsChanged.update((n) => n + 1);
            toast(`${loop.name} ${existing ? "saved" : "added"}`, {
              tone: "ok",
              description: loop.enabled && loop.next ? `Next run ${relativeTime(loop.next)}, on ${loop.onName ?? "its node"}.` : `It runs on ${loop.onName ?? "its node"}.`,
            });
          } catch (error) {
            replace(status, callout("danger", errorMessage(error), { title: "Not saved" }));
          }
        });
      },
    },
    existing ? null : h("div", { class: "fields" }, field("Name", name, { hint: "Lowercase: letters, digits, . _ -" }), field("Label (optional)", label)),
    existing ? field("Label (optional)", label) : null,
    h(
      "div",
      { class: "stack tight" },
      h("div", { class: "label" }, "When"),
      h("div", { class: "chips", role: "group", "aria-label": "Common schedules" }, ...presetChips.map((p) => p.chip)),
      field("Schedule", schedule, { hint: preview }),
    ),
    h("div", { class: "fields" }, field("Time zone", tz, { hint: "The clock a cron line is read in." }), field("Runs on", where, { hint: "Exactly one full node runs it." })),
    zones,
    h("div", { class: "stack tight" }, h("div", { class: "label" }, "What it does"), kindControl.el),
    existing && !task0 ? callout("warn", "This node can't read the loop's current task. Saving replaces it with what you choose here.") : null,
    heartbeatPanel,
    questPanel,
    callPanel,
    status,
    h("div", { class: "row", style: "justify-content:flex-end" }, button("Cancel", { onClick: () => sheet.close() }), save),
  );
  const sheet = openSheet({
    title: existing ? `Change ${existing.name}` : "Add a loop",
    description: "Work Galahad does on a schedule, on one node.",
    body: form,
    size: "wide",
    initialFocus: () => (existing ? schedule : name),
  });
  syncSchedule();

  if (!ctx.can("mind:read")) {
    replace(callPanel, callout("quiet", "Choosing a connector needs the mind:read scope."));
    return;
  }
  loadConnectors(ctx, sheet.scope.signal)
    .then((list) => {
      if (sheet.scope.disposed) return;
      installed = list.filter((c) => c.installed);
      if (!installed.length) {
        replace(
          callPanel,
          callout("info", "No connector is installed yet. Install one, add its key, and come back.", {
            actions: button("Open Connectors", {
              size: "sm",
              icon: "plug",
              onClick: () => {
                sheet.close();
                ctx.navigate("connectors");
              },
            }),
          }),
        );
        return;
      }
      replace(
        connectorSelect,
        h("option", { value: "" }, "Choose…"),
        ...installed.map((c) => h("option", { value: c.id, selected: c.id === initialCall?.connector }, c.label)),
      );
      syncTools(initialCall?.tool);
      if (initialCall) syncArgs(initialCall.args ?? {});
    })
    .catch((error: unknown) => {
      if (!sheet.scope.disposed) replace(callPanel, callout("danger", errorMessage(error), { title: "Couldn't load connectors" }));
    });
}

function runsList(ctx: Ctx, runs: LoopRunView[]): HTMLElement {
  if (!runs.length) return h("p", { class: "small subtle" }, "No runs yet.");
  return h(
    "div",
    { class: "card flat" },
    h(
      "div",
      { class: "rows" },
      ...runs.map((run) => {
        const st = RUN_STATUS[run.status] ?? RUN_STATUS.failed;
        return h(
          "div",
          { class: "item" },
          h("span", { class: "avatar", "data-tone": st.tone }, icon(st.icon, { size: 14 })),
          h(
            "div",
            { class: "grow" },
            h(
              "div",
              { class: "row wrap" },
              badge(st.label, st.tone),
              h("span", { class: "tiny subtle tnum", title: absoluteTime(run.started) }, relativeTime(run.started)),
            ),
            h("div", { class: "meta" }, h("span", { class: "tnum" }, duration(Math.max(0, run.finished - run.started))), h("span", {}, run.slot === null ? "by hand" : "on schedule"), h("span", {}, `on ${deviceName(ctx, run.node)}`)),
            run.summary ? h("p", { class: "small pre-wrap wrap-anywhere", style: "margin-top:6px" }, run.summary) : null,
          ),
        );
      }),
    ),
  );
}

export const loopsView: View = (root, ctx, { scope, opts }) => {
  const write = ctx.can("brain:write");
  const listBox = h("div", { class: "stack" }, skeletonBlock(132), skeletonBlock(132));
  const checkBox = h("div");
  let loops: LoopView[] | null = null;
  let signature = "";
  /** Runs started here and not yet in the history. */
  const pending = new Map<string, { run: string; since: number }>();
  const runs = new Map<string, LoopRunView[]>();

  async function loadRuns(name: string, box: HTMLElement): Promise<void> {
    try {
      const { runs: list } = await ctx.api.post<{ runs: LoopRunView[] }>("/api/loops/runs", { name, limit: 10 }, scope.signal);
      runs.set(name, list);
      if (box.isConnected) replace(box, runsList(ctx, list));
    } catch (error) {
      if (!scope.disposed && box.isConnected) replace(box, callout("danger", errorMessage(error)));
    }
  }

  async function runNow(loop: LoopView, trigger: HTMLButtonElement): Promise<void> {
    await busy(trigger, async () => {
      try {
        const { run, node } = await ctx.api.post<{ run: string; node: string }>("/api/loops/run", { name: loop.name });
        pending.set(loop.name, { run, since: Date.now() });
        toast(`${loop.name} started on ${node}`, { description: "Its result shows here when it's done." });
        void refresh();
      } catch (error) {
        toast(`Couldn't start ${loop.name}`, { tone: "error", description: errorMessage(error) });
      }
    });
  }

  async function setEnabled(loop: LoopView, enabled: boolean, trigger: HTMLButtonElement): Promise<void> {
    await busy(trigger, async () => {
      try {
        const { loop: next } = await ctx.api.post<{ loop: LoopView }>("/api/loops", { name: loop.name, enabled });
        toast(enabled ? `${loop.name} resumed` : `${loop.name} paused`, {
          tone: "ok",
          description: enabled ? (next.next ? `Next run ${relativeTime(next.next)}.` : undefined) : "It won't run until you resume it.",
        });
        void refresh();
      } catch (error) {
        toast(`Couldn't ${enabled ? "resume" : "pause"} ${loop.name}`, { tone: "error", description: errorMessage(error) });
      }
    });
  }

  async function remove(loop: LoopView): Promise<void> {
    const ok = await confirmAction({
      title: `Remove ${loop.name}?`,
      body: "It stops running on every node. Its past runs stay in the mind's history.",
      confirmLabel: "Remove loop",
    });
    if (!ok) return;
    try {
      await ctx.api.post("/api/loops/remove", { name: loop.name });
      pending.delete(loop.name);
      toast(`${loop.name} removed`, { tone: "ok" });
      void refresh();
    } catch (error) {
      toast("Couldn't remove it", { tone: "error", description: errorMessage(error) });
    }
  }

  function stateBadge(loop: LoopView, running: boolean): HTMLElement | null {
    if (running) return h("span", { class: "badge", "data-tone": "info" }, h("span", { class: "spinner", style: "width:10px;height:10px;border-width:1.5px", "aria-hidden": "true" }), "running");
    if (!loop.enabled) return badge("paused", "neutral");
    return null;
  }

  function loopCard(loop: LoopView): HTMLElement {
    const kind = loop.task ? KIND[loop.task.kind] : null;
    const running = pending.has(loop.name) || loop.running === true;
    const words = describeSchedule(loop.schedule);
    const last = loop.last;
    const st = last ? (RUN_STATUS[last.status] ?? RUN_STATUS.failed) : null;
    const cached = runs.get(loop.name);
    const runsBox = h("div", { style: "margin-top:8px" }, cached ? runsList(ctx, cached) : skeletonRows(2));
    const details = h("details", { class: "process" }, h("summary", { "data-key": `runs:${loop.name}` }, icon("chevron-right", { size: 14, class: "chev" }), "Recent runs"), runsBox);
    details.addEventListener("toggle", () => {
      if (details.open) void loadRuns(loop.name, runsBox);
    });
    return h(
      "article",
      { class: "card", "aria-label": `Loop ${loop.name}` },
      h(
        "div",
        { class: "card-body stack" },
        h(
          "div",
          { class: "row top" },
          h("span", { class: "avatar" }, icon(kind?.icon ?? "repeat", { size: 16 })),
          h(
            "div",
            { class: "grow" },
            h("div", { class: "row wrap" }, h("span", { class: "strong mono" }, loop.name), loop.label ? h("span", { class: "small muted" }, loop.label) : null, stateBadge(loop, running)),
            h(
              "div",
              { class: "tiny subtle row wrap", style: "margin-top:2px" },
              words ? h("span", { title: loop.schedule }, words) : h("span", { class: "mono" }, loop.schedule),
              h("span", {}, loop.tz),
              h("span", {}, `on ${loop.onName ?? deviceName(ctx, loop.on)}`),
            ),
          ),
        ),
        h("p", { class: "small muted wrap-anywhere" }, describeTask(loop.task)),
        loop.problem ? callout("warn", loop.problem) : null,
        h(
          "div",
          { class: "row wrap tiny subtle" },
          !loop.enabled
            ? h("span", {}, "Paused: it won't run until you resume it.")
            : loop.next
              ? h("span", { class: "tnum", title: absoluteTime(loop.next) }, `Next ${relativeTime(loop.next)}`)
              : null,
          last && st
            ? [badge(st.label, st.tone, st.icon), h("span", { title: absoluteTime(last.finished) }, `last ${relativeTime(last.finished)}`)]
            : h("span", {}, "Hasn't run yet."),
        ),
        last?.summary ? h("p", { class: "small ellipsis", title: firstLine(last.summary) }, firstLine(last.summary)) : null,
        write
          ? h(
              "div",
              { class: "row wrap" },
              button("Run now", { size: "sm", icon: "play", disabled: running || !loop.task, onClick: (event) => void runNow(loop, event.currentTarget as HTMLButtonElement) }),
              button(loop.enabled ? "Pause" : "Resume", {
                size: "sm",
                variant: "ghost",
                icon: loop.enabled ? "pause" : "play-circle",
                onClick: (event) => void setEnabled(loop, !loop.enabled, event.currentTarget as HTMLButtonElement),
              }),
              button("Change", { size: "sm", variant: "ghost", icon: "edit", onClick: () => openLoopSheet(ctx, loop) }),
              h("span", { class: "spacer" }),
              button(`Remove ${loop.name}`, { size: "sm", variant: "ghost", iconOnly: true, icon: "trash", onClick: () => void remove(loop) }),
            )
          : null,
        details,
      ),
    );
  }

  function render(): void {
    if (!loops) return;
    if (!loops.length) {
      replace(
        listBox,
        h(
          "div",
          { class: "card" },
          empty({
            icon: "repeat",
            title: "No loops yet",
            body: "A loop runs a heartbeat, a quest or a connector call on a schedule, on one node. A missed run happens once when its node is back.",
            actions: write ? button("Add a loop", { variant: "primary", icon: "plus", onClick: () => openLoopSheet(ctx) }) : null,
          }),
        ),
      );
      return;
    }
    replace(listBox, ...[...loops].sort((a, b) => a.name.localeCompare(b.name)).map(loopCard));
  }

  /** Runs started here that have landed in the history: say how they went. */
  function settle(list: LoopView[]): void {
    for (const [name, p] of pending) {
      const loop = list.find((l) => l.name === name);
      if (!loop || Date.now() - p.since > WATCH_MS) {
        pending.delete(name);
        continue;
      }
      if (loop.last?.run !== p.run) continue;
      pending.delete(name);
      runs.delete(name);
      const st = RUN_STATUS[loop.last.status] ?? RUN_STATUS.failed;
      toast(`${name}: ${st.label}`, {
        tone: loop.last.status === "ok" ? "ok" : loop.last.status === "failed" ? "error" : "warn",
        description: firstLine(loop.last.summary) || undefined,
      });
    }
  }

  async function refresh(): Promise<void> {
    try {
      const { loops: list } = await ctx.api.get<{ loops: LoopView[] }>("/api/loops", scope.signal);
      if (scope.disposed) return;
      settle(list);
      // Only re-render when something changed, so an open history or a focused button stays put.
      const next = JSON.stringify(list) + [...pending.keys()].join(",");
      if (next === signature) return;
      signature = next;
      loops = list;
      keepPlace(listBox, render);
    } catch (error) {
      if (!scope.disposed && loops === null) replace(listBox, h("div", { class: "card" }, errorState("Couldn't load loops", error, () => void refresh())));
    }
  }

  async function check(trigger: HTMLButtonElement): Promise<void> {
    await busy(trigger, async () => {
      try {
        const { node, findings } = await ctx.api.post<{ node: string; findings: FindingView[] }>("/api/heartbeat", {}, scope.signal);
        if (scope.disposed) return;
        replace(
          checkBox,
          section(
            "Checked just now",
            { actions: button("Close the check", { size: "sm", variant: "ghost", iconOnly: true, icon: "x", onClick: () => replace(checkBox) }) },
            h(
              "div",
              { class: "card" },
              findings.length
                ? h("div", { class: "rows" }, ...findings.map((f) => findingRow(ctx, f)))
                : h("div", { class: "card-body" }, callout("ok", `All quiet, as seen from ${node}.`)),
            ),
            h("p", { class: "tiny subtle" }, `The heartbeat's checks, run on ${node} just now. This check writes nothing; the heartbeat loop is what turns findings into notices in your Inbox.`),
          ),
        );
      } catch (error) {
        if (!scope.disposed) replace(checkBox, h("div", { class: "card" }, errorState("Couldn't run the checks", error)));
      }
    });
  }

  // ---------- self-action: the owner's one switch, the allowlist, and what he fixed lately ----------
  const selfBox = h("div", {}, skeletonBlock(96));
  let selfSignature = "";
  function renderSelf(view: SelfActionView): void {
    const toggle = switchControl(
      "Galahad fixes what's safe himself",
      view.on,
      (on) =>
        void (async () => {
          try {
            const next = await ctx.api.post<SelfActionView>("/api/self-action", { on });
            toast(on ? "Self-action is on" : "Self-action is off", { tone: "ok", description: on ? "After each heartbeat he fixes what's on the list himself, and asks you about the rest." : "He only reports now: every finding waits for you." });
            selfSignature = "";
            renderSelf(next);
            loopsChanged.update((n) => n + 1);
          } catch (error) {
            toast("Couldn't change it", { tone: "error", description: errorMessage(error) });
            renderSelf(view);
          }
        })(),
      {
        disabled: !write || !view.heartbeats.length,
        hint: view.heartbeats.length ? `After each run of ${view.heartbeats.join(", ")}. Everything else (anything outward, your data, the bank, the vault, devices, the roster) stays a notice or an approval.` : "There's no heartbeat loop for it to follow.",
      },
    );
    const allow = h(
      "ul",
      { class: "small muted", style: "margin:0;padding-left:18px" },
      ...view.allowlist.map((a) => h("li", {}, h("span", { class: "mono" }, a.kind), ` (${a.class}): ${a.why}`)),
    );
    const recent = view.recent.length
      ? h(
          "div",
          { class: "rows" },
          ...view.recent.slice(0, 6).map((e) => {
            const failed = e.reason?.startsWith("Galahad's own fix didn't") ?? false;
            const at = Number(e.hlc.slice(0, 15));
            return h(
              "div",
              { class: "item" },
              h("span", { class: "avatar", "data-tone": failed ? "warn" : "ok" }, icon(failed ? "alert" : "check-circle", { size: 14 })),
              h("div", { class: "grow" }, h("div", { class: "small strong" }, `${failed ? "Tried" : "Fixed"}: ${e.detail ?? e.target}`), h("div", { class: "tiny subtle", title: absoluteTime(at) }, relativeTime(at))),
            );
          }),
        )
      : h("p", { class: "tiny subtle" }, "Nothing fixed yet.");
    replace(selfBox, h("div", { class: "card" }, h("div", { class: "card-body stack" }, toggle, h("div", { class: "stack tight" }, h("div", { class: "label" }, "What he may fix"), allow), h("div", { class: "stack tight" }, h("div", { class: "label" }, "Lately"), recent))));
  }
  async function refreshSelf(): Promise<void> {
    try {
      const view = await ctx.api.get<SelfActionView>("/api/self-action", scope.signal);
      if (scope.disposed) return;
      const next = JSON.stringify(view);
      if (next === selfSignature) return;
      selfSignature = next;
      keepPlace(selfBox, () => renderSelf(view));
    } catch (error) {
      // An older node has no self-action yet: say nothing.
      if (!scope.disposed && !selfSignature) replace(selfBox);
    }
  }

  const checkButton = button("Check now", { icon: "review", onClick: () => void check(checkButton) });
  replace(
    root,
    h(
      "div",
      { class: "page narrow" },
      pageHead(
        "Loops",
        "Work Galahad does on a schedule, each loop on exactly one node. A missed run happens once when its node is back; a run cut short is never repeated.",
        [checkButton, write ? button("Add loop", { variant: "primary", icon: "plus", onClick: () => openLoopSheet(ctx) }) : null],
      ),
      write ? null : callout("quiet", "This device can see loops but not change or run them (no brain:write scope)."),
      checkBox,
      section("Self-action", {}, selfBox),
      section("Loops", {}, listBox),
    ),
  );

  scope.add(
    loopsChanged.subscribe(() => {
      signature = "";
      void refresh();
    }),
  );
  // Every 9 s, or every 3 s while a run started here is under way.
  let tick = 0;
  scope.interval(() => {
    if (pending.size || ++tick % 3 === 0) void refresh();
    if (tick % 5 === 0) void refreshSelf();
  }, 3000);
  void refresh();
  void refreshSelf();
  if (opts.intent === "add-loop") openLoopSheet(ctx);
  else if (opts.intent === "check") void check(checkButton);
};
