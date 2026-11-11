import type { ActionView, NoticeView } from "@galahad/core";
import { type Ctx, errorMessage, type View } from "../context.ts";
import { isWaiting } from "../live.ts";
import { callerName, defaultLabel, deleteName, rowsFromCall } from "../lib/orders.ts";
import { hlcMs, relativeTime } from "../lib/time.ts";
import type { ActionClass } from "../types.ts";
import { badge, busy, button, callout, empty, pageHead, section, skeletonRows, type Tone } from "../ui/controls.ts";
import { confirmAction } from "../ui/dialog.ts";
import { h, keepPlace, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { toast } from "../ui/toast.ts";
import { CLASS_INFO, deviceName } from "./activity.ts";
import { openInvite, pairingCard } from "./fleet.ts";
import { findingRow } from "./loops.ts";
import { openOrderFromAction } from "./orders.ts";
import { secretRequestCard } from "./vault.ts";

/*
 * Everything that needs the owner, in one place: devices asking to join,
 * credentials Galahad asked for, actions his oath makes him ask about, and
 * what the heartbeat noticed. Approvals scale with stakes: a phone is one click
 * after comparing codes; a machine asks once more; an outward action is shown
 * in full and confirmed; a delete makes you type what it deletes.
 */

const STATE: Record<ActionView["state"], { label: string; tone: Tone }> = {
  waiting: { label: "waiting for you", tone: "warn" },
  approved: { label: "approved · sending", tone: "accent" },
  done: { label: "sent", tone: "ok" },
  failed: { label: "failed", tone: "danger" },
  denied: { label: "declined", tone: "neutral" },
  expired: { label: "expired unanswered", tone: "neutral" },
};

/** "loop:morning" → "the loop morning"; who asked, as the owner would say it. */
function askedBy(by: string): HTMLElement {
  const [kind, ...rest] = by.split(":");
  const who = rest.join(":");
  const words: Record<string, string> = { loop: "the loop", arm: "the arm", node: "the node", quest: "the quest" };
  return words[kind!] && who ? h("span", {}, `${words[kind!]} `, h("span", { class: "mono" }, who)) : h("span", { class: "mono" }, by);
}

function argsList(args: Record<string, unknown>): HTMLElement | null {
  const entries = Object.entries(args);
  if (!entries.length) return null;
  return h(
    "dl",
    { class: "kv" },
    ...entries.flatMap(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return [h("dt", { class: "mono" }, key), h("dd", { class: "mono pre-wrap" }, text.length > 800 ? `${text.slice(0, 800)}…` : text)];
    }),
  );
}

/** Work a request would send (a shipment's kept changes): read it before you answer. */
function keptWork(ctx: Ctx, action: ActionView): HTMLElement | null {
  const id = action.args.artifact;
  if (typeof id !== "string" || !/^art_[A-Za-z0-9_-]{22}$/.test(id)) return null;
  return h(
    "div",
    { class: "row wrap" },
    button("Read the changes", { size: "sm", icon: "archive", onClick: () => ctx.navigate("artifacts", { intent: id }) }),
    h("span", { class: "tiny subtle" }, "The work this sends, kept with its SHA-256s: changes.patch, and the files themselves under ship/."),
  );
}

/** An action Galahad wants to take that the oath says to ask about. Nothing leaves until you approve it. */
function actionCard(ctx: Ctx, action: ActionView): HTMLElement {
  const info = CLASS_INFO[action.class as ActionClass];
  const destructive = action.class === "delete";
  const node = deviceName(ctx, action.node);
  const asked = hlcMs(action.requestedAt);
  const expires = h("span", { class: "tnum expires", "data-expires": String(action.expires) }, `Expires ${relativeTime(action.expires)}`);
  const note = h("div");
  const admin = ctx.can("fleet:admin");
  const approve = button(destructive ? "Approve delete…" : "Approve…", { variant: "primary", icon: "check" });
  const decline = button("Decline", { variant: "danger", icon: "x" });
  // Approve, and answer calls like it the same way next time: a standing order, signed in the same step.
  const similar = button("Approve and allow similar…", { icon: "scroll" });

  async function decide(yes: boolean, trigger: HTMLButtonElement): Promise<void> {
    await busy(trigger, async () => {
      try {
        await ctx.api.post("/api/actions/decide", { id: action.id, approve: yes });
        toast(yes ? "Approved" : "Declined", {
          tone: yes ? "ok" : "info",
          description: yes ? `${node} sends it once, now.` : "Nothing was sent.",
        });
        await ctx.live.refreshActions();
      } catch (error) {
        replace(note, callout("danger", errorMessage(error), { title: yes ? "Couldn't approve" : "Couldn't decline" }));
        await ctx.live.refreshActions();
      }
    });
  }

  approve.addEventListener("click", async () => {
    // The card says what and why; this says what happens next, once more, before anything leaves.
    const ok = await confirmAction({
      title: destructive ? "Approve this delete?" : "Approve and send?",
      body: [
        h("p", {}, h("span", { class: "mono strong wrap-anywhere" }, action.target), ` through ${action.connector}.`),
        h(
          "p",
          {},
          destructive
            ? `${node} deletes it once, as soon as you approve. It can't be brought back.`
            : `${node} sends it once, as soon as you approve. It can't be called back, and if it fails it isn't retried.`,
        ),
      ],
      confirmLabel: destructive ? "Approve delete" : "Approve and send",
      tone: destructive ? "danger" : "primary",
      typeToConfirm: destructive ? deleteName(action) : undefined,
    });
    if (ok) await decide(true, approve);
  });
  decline.addEventListener("click", () => void decide(false, decline));
  similar.addEventListener("click", () =>
    openOrderFromAction(ctx, action, {
      rows: rowsFromCall(action),
      caller: callerName(action.by),
      label: defaultLabel(action),
      node,
      confirmName: deleteName(action),
      onDone: () => void ctx.live.refreshActions(),
    }),
  );

  return h(
    "article",
    { class: `card ${destructive ? "danger" : "accent"}`, "aria-label": `Galahad asks to ${info?.label.toLowerCase() ?? action.class}: ${action.target}` },
    h(
      "div",
      { class: "card-body stack" },
      h(
        "div",
        { class: "row top" },
        h("span", { class: "avatar agent" }, icon("mark", { size: 16 })),
        h(
          "div",
          { class: "grow stack tight" },
          h(
            "div",
            { class: "row wrap" },
            h("span", { class: "strong mono" }, `${action.connector}.${action.tool}`),
            info ? badge(info.label.toLowerCase(), info.tone, info.icon) : badge(action.class, "warn"),
          ),
          h("div", { class: "mono small wrap-anywhere" }, action.target),
          h("div", { class: "tiny subtle row wrap" }, h("span", {}, "Asked by ", askedBy(action.by)), h("span", {}, `on ${node}`), asked ? h("span", { title: new Date(asked).toLocaleString() }, relativeTime(asked)) : null),
        ),
      ),
      action.why ? h("div", { class: "quote small" }, action.why) : null,
      argsList(action.args),
      keptWork(ctx, action),
      h(
        "p",
        { class: "tiny subtle" },
        expires,
        ". No answer means no. ",
        destructive
          ? "Deleting anything persistent asks you, unless a standing order of yours names exactly this."
          : "Outward actions (posting, sending, pushing, the physical world) ask you, unless a standing order of yours covers them.",
      ),
      admin
        ? h("div", { class: "row wrap", style: "justify-content:flex-end" }, decline, similar, approve)
        : callout("quiet", h("span", {}, "This device can't answer (no fleet:admin scope). Answer from one that can, or on a node: ", h("code", {}, `galahad action approve ${action.id}`))),
      note,
    ),
  );
}

function decidedRow(ctx: Ctx, action: ActionView): HTMLElement {
  const state = STATE[action.state] ?? { label: action.state, tone: "neutral" as Tone };
  const asked = hlcMs(action.requestedAt);
  return h(
    "div",
    { class: "item" },
    h("span", { class: "avatar", "data-tone": state.tone }, icon(action.state === "done" ? "check" : action.state === "failed" ? "x" : action.state === "approved" ? "external" : "minus", { size: 14 })),
    h(
      "div",
      { class: "grow" },
      h("div", { class: "row wrap" }, h("span", { class: "strong mono small" }, `${action.connector}.${action.tool}`), badge(state.label, state.tone)),
      h("div", { class: "mono tiny subtle wrap-anywhere" }, action.target),
      h(
        "div",
        { class: "meta" },
        h("span", {}, "asked by ", askedBy(action.by)),
        asked ? h("span", {}, relativeTime(asked)) : null,
        action.order
          ? h("span", { class: "row", style: "gap:4px" }, icon("scroll", { size: 12 }), `answered by your standing order "${action.order.label}"`)
          : action.decidedVia
            ? h("span", {}, `answered from ${deviceName(ctx, action.decidedVia)}`)
            : null,
      ),
      action.receipt ? h("details", { class: "process", style: "margin-top:6px" }, h("summary", { "data-key": `receipt:${action.id}` }, icon("chevron-right", { size: 14, class: "chev" }), "Receipt"), h("pre", { class: "result", style: "margin-top:6px" }, action.receipt)) : null,
    ),
  );
}

export const inboxView: View = (root, ctx, { scope }) => {
  const pairingsBox = h("div", { class: "stack" });
  const requestsBox = h("div", { class: "stack" });
  const actionsBox = h("div", { class: "stack" });
  const noticesBox = h("div", { class: "card" });
  const historyRows = h("div", { class: "rows", style: "border-top:1px solid var(--border)" });
  const historySummary = h("span", { class: "small strong" });
  const allClear = h("div");
  const admin = ctx.can("fleet:admin");
  const vault = ctx.can("vault:read");
  const read = ctx.can("mind:read");

  const waiting = () => ctx.live.actions.value.filter((a) => isWaiting(a));
  const openNotices = () => ctx.live.notices.value.filter((n) => !n.dismissed);

  async function dismiss(n: NoticeView, trigger: HTMLButtonElement): Promise<void> {
    await busy(trigger, async () => {
      try {
        await ctx.api.post("/api/notices/dismiss", { key: n.key });
        toast("Dismissed", { description: "It stays quiet until it changes." });
        await ctx.live.refreshNotices();
      } catch (error) {
        toast("Couldn't dismiss it", { tone: "error", description: errorMessage(error) });
      }
    });
  }

  // Each list re-renders only when it changes, so a half-typed key in a request card survives a new pairing.
  const renderPairings = () => {
    const pairings = ctx.live.pairings.value;
    replace(pairingsBox, ...pairings.map((p) => pairingCard(ctx, p)));
    pairingsSection.hidden = !admin || !pairings.length;
    renderAllClear();
  };
  const renderRequests = () => {
    const requests = ctx.live.secretRequests.value;
    replace(requestsBox, ...requests.map((r) => secretRequestCard(ctx, r)));
    requestsSection.hidden = !vault || !requests.length;
    renderAllClear();
  };
  let shownWaiting = "";
  const renderActions = () => {
    const list = waiting();
    // Cards are rebuilt only when what waits changes, not when the history moves on.
    const signature = JSON.stringify(list);
    if (signature !== shownWaiting) {
      shownWaiting = signature;
      replace(actionsBox, ...list.map((a) => actionCard(ctx, a)));
    }
    actionsSection.hidden = !list.length;
    const decided = ctx.live.actions.value.filter((a) => !isWaiting(a)).slice(0, 6);
    keepPlace(historyRows, () => replace(historyRows, ...decided.map((a) => decidedRow(ctx, a))));
    historySummary.textContent = `Recent decisions (${decided.length})`;
    history.hidden = !decided.length;
    renderAllClear();
  };
  const renderNotices = () => {
    const list = openNotices();
    // Dismissing is yours alone: it needs fleet:admin, which agents never hold.
    const write = ctx.can("fleet:admin");
    replace(
      noticesBox,
      h(
        "div",
        { class: "rows" },
        ...list.map((n) =>
          findingRow(
            ctx,
            n,
            [h("span", {}, n.source), h("span", { title: new Date(n.at).toLocaleString() }, relativeTime(n.at))],
            write ? button("Dismiss", { size: "sm", variant: "ghost", icon: "x", label: `Dismiss: ${n.title}`, onClick: (event) => void dismiss(n, event.currentTarget as HTMLButtonElement) }) : null,
          ),
        ),
      ),
    );
    noticesSection.hidden = !list.length;
    renderAllClear();
  };
  const renderAllClear = () => {
    const pending = ctx.live.pairings.value.length + ctx.live.secretRequests.value.length + waiting().length + openNotices().length;
    // Until the first answer, a skeleton: "nothing needs you" would be a guess, and pushed away a moment later.
    const loaded = ctx.live.inboxLoaded.value;
    allClear.hidden = loaded && pending > 0;
    replace(
      allClear,
      !loaded
        ? h("div", { class: "card" }, skeletonRows(2, { avatar: true }))
        : pending === 0
        ? h(
            "div",
            { class: "card" },
            empty({
              icon: "check-circle",
              title: "Nothing needs you",
              body: "When a device asks to join, Galahad needs a credential or wants to do something his oath says to ask about, or the heartbeat spots trouble, it waits here.",
              actions: admin ? button("Pair a device", { icon: "plus", onClick: () => openInvite(ctx, "client") }) : null,
            }),
          )
        : null,
    );
  };

  const pairingsSection = section("Devices asking to join", {}, pairingsBox);
  const actionsSection = section(
    "Galahad asks your leave",
    {},
    h(
      "p",
      { class: "tiny subtle" },
      "Anything outward, and every delete, waits for you unless a standing order answers it. Approved, it's sent once; no answer in 24 hours means no.",
    ),
    actionsBox,
  );
  const requestsSection = section("Credentials Galahad asked for", {}, requestsBox);
  const noticesSection = section("Noticed by the heartbeat", { actions: h("a", { href: "#/loops", class: "btn ghost sm" }, "Loops", icon("chevron-right", { size: 14 })) }, noticesBox);
  // Kept across re-renders so it stays open while the outbox changes.
  const history = h("details", { class: "card", hidden: true }, h("summary", { class: "card-head", style: "cursor:pointer;border-bottom:0" }, icon("chevron-right", { size: 14 }), historySummary), historyRows);

  replace(
    root,
    h(
      "div",
      { class: "page narrow" },
      pageHead("Inbox", "Everything that needs you. Nothing here happens without your say."),
      allClear,
      pairingsSection,
      actionsSection,
      requestsSection,
      noticesSection,
      read ? history : null,
    ),
  );

  scope.add(ctx.live.pairings.subscribe(renderPairings));
  scope.add(ctx.live.secretRequests.subscribe(renderRequests));
  scope.add(ctx.live.actions.subscribe(renderActions));
  scope.add(ctx.live.notices.subscribe(renderNotices));
  scope.add(ctx.live.inboxLoaded.subscribe(renderAllClear));
  renderPairings();
  renderRequests();
  renderActions();
  renderNotices();
  void ctx.live.refreshInbox();
  scope.interval(() => void ctx.live.refreshInbox(), 2000);
  // Deadlines tick without a re-render (that would lose a half-made decision).
  scope.interval(() => {
    for (const el of root.querySelectorAll<HTMLElement>(".expires")) {
      const at = Number(el.dataset.expires);
      el.textContent = at > Date.now() ? `Expires ${relativeTime(at)}` : "Expired";
    }
  }, 30_000);
};
