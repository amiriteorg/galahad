import type { Ctx, View } from "../context.ts";
import { shortId } from "../lib/text.ts";
import { clockTime, dayKey, dayLabel, hlcMs, relativeTime } from "../lib/time.ts";
import { isUnavailable } from "../api.ts";
import type { ActionClass, LedgerEntry, Verdict } from "../types.ts";
import { badge, empty, errorState, pageHead, section, skeletonRows, type Tone } from "../ui/controls.ts";
import { debounce, h, replace } from "../ui/dom.ts";
import { icon, type IconName } from "../ui/icons.ts";

/*
 * The ledger: every side-effecting action Galahad classified, with the oath's
 * verdict and why. Reads are free, creating and modifying are logged, outward
 * and destructive actions ask, and anything that breaks a hard limit is denied.
 */

export const CLASS_INFO: Record<ActionClass, { label: string; icon: IconName; tone: Tone; rule: string; verdict: Verdict | "allow (logged)" }> = {
  read: { label: "Read", icon: "eye", tone: "neutral", rule: "Look, list, fetch", verdict: "allow" },
  create: { label: "Create", icon: "plus", tone: "info", rule: "New bucket, branch, container, credential", verdict: "allow (logged)" },
  modify: { label: "Modify", icon: "edit", tone: "info", rule: "Change config, write objects, edit files", verdict: "allow (logged)" },
  outward: { label: "Outward", icon: "external", tone: "warn", rule: "Push, send, post, deploy, purchase", verdict: "ask" },
  delete: { label: "Delete", icon: "trash", tone: "danger", rule: "Remove anything persistent", verdict: "ask" },
  forbidden: { label: "Forbidden", icon: "ban", tone: "danger", rule: "Breaks a hard limit of the oath", verdict: "deny" },
};

export const VERDICT_TONE: Record<Verdict, Tone> = { allow: "ok", ask: "warn", deny: "danger", approved: "accent" };
const VERDICT_LABEL: Record<Verdict, string> = { allow: "allowed", ask: "asked you", deny: "denied", approved: "you approved" };

export function verdictBadge(verdict: Verdict): HTMLElement {
  return badge(VERDICT_LABEL[verdict] ?? verdict, VERDICT_TONE[verdict] ?? "neutral");
}

/** A device id as the owner knows it: this node, a fleet name, or a short id. */
export function deviceName(ctx: Ctx, id: string): string {
  if (id === ctx.whoami.node) return ctx.whoami.nodeName;
  const known = ctx.live.fleet.value?.devices.find((d) => d.id === id);
  return known?.name ?? shortId(id);
}

export function ledgerItem(ctx: Ctx, entry: LedgerEntry, compact = false): HTMLElement {
  const info = CLASS_INFO[entry.class] ?? CLASS_INFO.read;
  const ms = hlcMs(entry.hlc);
  return h(
    "div",
    { class: "tl-item", "data-tone": info.tone },
    h("span", { class: "tl-icon", title: info.label }, icon(info.icon)),
    h(
      "div",
      { class: "tl-main" },
      h("div", { class: "tl-title" }, h("span", { class: "strong small" }, entry.resource), h("span", { class: "mono small wrap-anywhere" }, entry.target), verdictBadge(entry.verdict)),
      h(
        "div",
        { class: "meta", style: "display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:4px;font-size:12px;color:var(--text-3)" },
        h("span", {}, info.label.toLowerCase()),
        entry.quest ? h("span", {}, "quest ", h("span", { class: "mono" }, entry.quest)) : null,
        h("span", {}, "on ", deviceName(ctx, entry.device)),
        entry.reason ? h("span", { style: "color:var(--text-2)" }, entry.reason) : null,
      ),
      !compact && entry.detail ? h("details", { style: "margin-top:4px" }, h("summary", {}, "Details"), h("pre", {}, entry.detail)) : null,
    ),
    h("span", { class: "tl-time", title: ms ? new Date(ms).toLocaleString() : "" }, ms ? (compact ? relativeTime(ms) : clockTime(ms)) : ""),
  );
}

/** The autonomy view: what Galahad may do on his own, what asks, what's denied, with recent counts. */
export function autonomyCard(entries: LedgerEntry[] | null): HTMLElement {
  const since = Date.now() - 24 * 3600_000;
  const counts = new Map<ActionClass, number>();
  for (const e of entries ?? []) {
    const ms = hlcMs(e.hlc);
    if (ms && ms >= since) counts.set(e.class, (counts.get(e.class) ?? 0) + 1);
  }
  return h(
    "div",
    { class: "card" },
    h("div", { class: "card-head" }, icon("shield", { size: 16 }), h("h3", { class: "grow" }, "Autonomy"), h("span", { class: "tiny subtle" }, entries ? "last 24 h" : "")),
    h(
      "div",
      { class: "autonomy" },
      ...(Object.keys(CLASS_INFO) as ActionClass[]).map((cls) => {
        const info = CLASS_INFO[cls];
        const n = counts.get(cls);
        const tone: Tone = info.verdict === "ask" ? "warn" : info.verdict === "deny" ? "danger" : "ok";
        return h(
          "div",
          { class: "a-row" },
          h("div", { class: "row", style: "gap:10px" }, h("span", { style: "color:var(--text-3)" }, icon(info.icon, { size: 15 })), h("div", {}, h("div", { class: "strong" }, info.label), h("div", { class: "tiny subtle" }, info.rule))),
          h("div", { class: "row", style: "gap:8px" }, n ? h("span", { class: "tiny subtle tnum" }, String(n)) : null, badge(info.verdict, tone)),
        );
      }),
    ),
    h("div", { class: "card-foot tiny subtle" }, "Set by the oath. Only you can amend it, with your signature. Galahad may clean up ephemeral things he made for a quest."),
  );
}

export const activityView: View = (root, ctx, { scope }) => {
  let entries: LedgerEntry[] = [];
  const classes = new Set<ActionClass>();
  let verdict: Verdict | "all" = "all";
  const timeline = h("div", { class: "card" }, skeletonRows(6));
  const autonomyBox = h("div", {}, autonomyCard(null));
  const countLabel = h("span", { class: "count-label tnum" });
  const search = h("input", { class: "input", type: "search", placeholder: "Filter by resource, target or quest", "aria-label": "Filter activity", autocomplete: "off" });

  function filtered(): LedgerEntry[] {
    const q = search.value.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!classes.size || classes.has(e.class)) &&
        (verdict === "all" || e.verdict === verdict) &&
        (!q || [e.resource, e.target, e.quest ?? "", e.reason ?? ""].some((s) => s.toLowerCase().includes(q))),
    );
  }

  function render(): void {
    const list = filtered();
    countLabel.textContent = entries.length ? `${list.length} of ${entries.length}` : "";
    if (!entries.length) {
      replace(timeline, empty({ icon: "activity", title: "Nothing recorded yet", body: "When Galahad creates, changes, sends or deletes anything, it is written here with the oath's verdict." }));
      return;
    }
    if (!list.length) {
      replace(timeline, empty({ icon: "filter", title: "Nothing matches these filters", compact: true }));
      return;
    }
    const nodes: HTMLElement[] = [];
    let day = "";
    for (const entry of list) {
      const ms = hlcMs(entry.hlc) ?? 0;
      if (dayKey(ms) !== day) {
        day = dayKey(ms);
        nodes.push(h("div", { class: "tl-day" }, dayLabel(ms)));
      }
      nodes.push(ledgerItem(ctx, entry));
    }
    replace(timeline, h("div", { class: "timeline" }, ...nodes));
  }

  async function load(): Promise<void> {
    try {
      const { entries: loaded } = await ctx.api.get<{ entries: LedgerEntry[] }>("/api/ledger", scope.signal);
      if (scope.disposed) return;
      entries = [...loaded].sort((a, b) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : 0));
      replace(autonomyBox, autonomyCard(entries));
      const filters = root.querySelector<HTMLElement>(".filters");
      if (filters) filters.hidden = entries.length === 0;
      render();
    } catch (error) {
      if (scope.disposed) return;
      if (isUnavailable(error)) {
        replace(
          timeline,
          empty({
            icon: "scroll",
            title: "The ledger isn't on this node yet",
            body: "It arrives with an upcoming update. Until then, the oath still gates every action; it just isn't shown here.",
          }),
        );
        stop();
      } else replace(timeline, errorState("Couldn't read the ledger", error, () => void load()));
    }
  }

  const classChips = (Object.keys(CLASS_INFO) as ActionClass[]).map((cls) => {
    const chip = h("button", { class: "chip", type: "button", "aria-pressed": "false" }, icon(CLASS_INFO[cls].icon), CLASS_INFO[cls].label);
    chip.addEventListener("click", () => {
      classes.has(cls) ? classes.delete(cls) : classes.add(cls);
      chip.setAttribute("aria-pressed", String(classes.has(cls)));
      render();
    });
    return chip;
  });
  const verdictChips = (["all", "allow", "ask", "deny", "approved"] as const).map((v) => {
    const chip = h("button", { class: "chip", type: "button", "aria-pressed": String(v === verdict) }, v === "all" ? "Any verdict" : VERDICT_LABEL[v]);
    chip.addEventListener("click", () => {
      verdict = v;
      for (const c of verdictChips) c.setAttribute("aria-pressed", String(c === chip));
      render();
    });
    return chip;
  });
  const renderSoon = debounce(render, 120);
  search.addEventListener("input", renderSoon);
  scope.add(() => renderSoon.cancel());

  replace(
    root,
    h(
      "div",
      { class: "page" },
      pageHead("Activity", "Everything Galahad does is written down. Reads are free, creating is logged, outward and destructive actions ask you first."),
      h(
        "div",
        { class: "two-col" },
        h(
          "div",
          { class: "stack loose" },
          h(
            "div",
            { class: "stack tight filters", hidden: true },
            h("div", { class: "input-wrap" }, icon("search", { size: 16 }), search),
            h("div", { class: "chips", role: "group", "aria-label": "Action class" }, ...classChips),
            h("div", { class: "chips", role: "group", "aria-label": "Verdict" }, ...verdictChips),
          ),
          section("Timeline", {}, timeline),
        ),
        h("div", { class: "stack loose" }, autonomyBox),
      ),
    ),
  );
  root.querySelector(".section-head h2")?.after(countLabel);

  let timer: ReturnType<typeof setInterval> | null = setInterval(() => void load(), 10_000);
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  scope.add(stop);
  void load();
};
