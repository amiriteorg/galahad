import type { ActionView, LoopDraftView, NoticeView } from "@galahad/core";
import { type Ctx, errorMessage, type View } from "../context.ts";
import { isWaiting } from "../live.ts";
import { callerName, defaultLabel, deleteName, rowsFromCall } from "../lib/orders.ts";
import { hlcMs, relativeTime } from "../lib/time.ts";
import type { ActionClass } from "../types.ts";
import { badge, busy, button, callout, card, disclosure, empty, formActions, linkButton, listRow, note, pageBody, pageHead, rows, section, skeletonRows, type Tone } from "../ui/controls.ts";
import { confirmAction } from "../ui/dialog.ts";
import { h, keepPlace, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { toast } from "../ui/toast.ts";
import { factRow } from "./about-you.ts";
import { CLASS_INFO, deviceName } from "./activity.ts";
import { connectorRequestCard } from "./connectors.ts";
import { openInvite, pairingCard } from "./fleet.ts";
import { describeTask, findingRow, loopsChanged } from "./loops.ts";
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
  lapsed: { label: "approval expired · never sent", tone: "neutral" },
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
/** A loop Galahad drafted when you asked for one in chat: it runs nothing until you add it here (or dismiss it). */
function loopDraftCard(ctx: Ctx, draft: LoopDraftView): HTMLElement {
  const outcome = h("div");
  const mayAdd = ctx.can("brain:write");
  const add = button(draft.replaces ? "Add, replacing yours" : "Add loop", { variant: "primary", icon: "check" });
  const dismiss = button("Dismiss", { icon: "x" });
  const answer = async (trigger: HTMLButtonElement, adding: boolean) =>
    busy(trigger, async () => {
      try {
        if (adding) {
          await ctx.api.post("/api/loops", { name: draft.name, schedule: draft.schedule, tz: draft.tz, task: draft.task, ...(draft.on ? { on: draft.on } : {}), ...(draft.label ? { label: draft.label } : {}), draft: draft.id });
          loopsChanged.update((n) => n + 1);
          toast(`Added loop ${draft.name}`, { tone: "ok", description: "It runs on its schedule from now: see Loops." });
        } else {
          await ctx.api.post("/api/loops/drafts/dismiss", { id: draft.id });
          toast("Dismissed", { tone: "info", description: "Nothing was added." });
        }
      } catch (error) {
        replace(outcome, callout("danger", errorMessage(error), { title: adding ? "Couldn't add it" : "Couldn't dismiss it" }));
      }
      await ctx.live.refreshLoopDrafts();
    });
  add.addEventListener("click", () => void answer(add, true));
  dismiss.addEventListener("click", () => void answer(dismiss, false));
  return card(
    { tone: "accent", label: `Galahad drafted a loop: ${draft.label ?? draft.name}` },
    listRow({
      lead: "repeat",
      leadTone: "agent",
      top: true,
      title: h("span", { class: "row wrap" }, h("span", {}, draft.label ?? draft.name), h("span", { class: "mono tiny subtle" }, draft.name)),
      sub: `${draft.schedule}${draft.tz !== "UTC" ? ` (${draft.tz})` : ""}${draft.on ? ` on ${draft.on}` : ""}`,
      meta: [h("span", {}, `Drafted by ${draft.by === "galahad" ? "Galahad" : draft.by}`), h("span", { title: new Date(draft.at).toLocaleString() }, relativeTime(draft.at))],
    }),
    h("p", { class: "small muted wrap-anywhere" }, describeTask(draft.task)),
    draft.why ? h("div", { class: "quote small" }, draft.why) : null,
    note(draft.replaces ? `Adding it replaces your loop ${draft.name}. ` : "", `It runs nothing until you add it. Unanswered, it's gone ${relativeTime(draft.expires)}.`),
    mayAdd
      ? formActions(dismiss, add)
      : callout("quiet", h("span", {}, "This device can't add loops (no brain:write scope). Add it from one that can, or on a node: ", h("code", {}, `galahad loop add --draft ${draft.id}`))),
    outcome,
  );
}

function actionCard(ctx: Ctx, action: ActionView): HTMLElement {
  const info = CLASS_INFO[action.class as ActionClass];
  const destructive = action.class === "delete";
  const node = deviceName(ctx, action.node);
  const asked = hlcMs(action.requestedAt);
  const expires = h("span", { class: "tnum expires", "data-expires": String(action.expires) }, `Expires ${relativeTime(action.expires)}`);
  const outcome = h("div");
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
        replace(outcome, callout("danger", errorMessage(error), { title: yes ? "Couldn't approve" : "Couldn't decline" }));
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

  return card(
    { tone: destructive ? "danger" : "accent", label: `Galahad asks to ${info?.label.toLowerCase() ?? action.class}: ${action.target}` },
    listRow({
      lead: "mark",
      leadTone: "agent",
      top: true,
      title: h("span", { class: "row wrap" }, h("span", { class: "mono" }, `${action.connector}.${action.tool}`), info ? badge(info.label.toLowerCase(), info.tone, info.icon) : badge(action.class, "warn")),
      sub: h("span", { class: "mono" }, action.target),
      meta: [h("span", {}, "Asked by ", askedBy(action.by)), h("span", {}, `on ${node}`), asked ? h("span", { title: new Date(asked).toLocaleString() }, relativeTime(asked)) : null],
    }),
    action.why ? h("div", { class: "quote small" }, action.why) : null,
    argsList(action.args),
    keptWork(ctx, action),
    note(
      expires,
      ". No answer means no. ",
      destructive
        ? "Deleting anything persistent asks you, unless a standing order of yours names exactly this."
        : "Outward actions (posting, sending, pushing, the physical world) ask you, unless a standing order of yours covers them.",
    ),
    admin
      ? formActions(decline, similar, approve)
      : callout("quiet", h("span", {}, "This device can't answer (no fleet:admin scope). Answer from one that can, or on a node: ", h("code", {}, `galahad action approve ${action.id}`))),
    outcome,
  );
}

function decidedRow(ctx: Ctx, action: ActionView): HTMLElement {
  const state = STATE[action.state] ?? { label: action.state, tone: "neutral" as Tone };
  const asked = hlcMs(action.requestedAt);
  return listRow({
    lead: action.state === "done" ? "check" : action.state === "failed" ? "x" : action.state === "approved" ? "external" : "minus",
    leadTone: state.tone,
    top: true,
    title: h("span", { class: "row wrap" }, h("span", { class: "mono" }, `${action.connector}.${action.tool}`), badge(state.label, state.tone)),
    sub: h("span", { class: "mono" }, action.target),
    meta: [
      h("span", {}, "asked by ", askedBy(action.by)),
      asked ? h("span", {}, relativeTime(asked)) : null,
      action.order
        ? h("span", { class: "row tight" }, icon("scroll", { size: 12 }), `answered by your standing order "${action.order.label}"`)
        : action.decidedVia
          ? h("span", {}, `answered from ${deviceName(ctx, action.decidedVia)}`)
          : null,
    ],
    body: action.receipt ? h("details", { class: "process" }, h("summary", { "data-key": `receipt:${action.id}` }, icon("chevron-right", { size: 14, class: "chev" }), "Receipt"), h("pre", { class: "result process-body" }, action.receipt)) : null,
  });
}

export const inboxView: View = (root, ctx, { scope }) => {
  const pairingsBox = h("div", { class: "stack" });
  const requestsBox = h("div", { class: "stack" });
  const draftsBox = h("div", { class: "stack" });
  const connectorsBox = h("div", { class: "stack" });
  const actionsBox = h("div", { class: "stack" });
  const noticesBox = card({ flush: true });
  const historyRows = rows();
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
      rows(
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

  const renderDrafts = () => {
    const drafts = ctx.live.loopDrafts.value;
    replace(draftsBox, ...drafts.map((d) => loopDraftCard(ctx, d)));
    draftsSection.hidden = !drafts.length;
    renderAllClear();
  };

  const renderAboutYou = () => {
    const facts = ctx.live.aboutYou.value;
    replace(aboutYouBox, ...facts.map((m) => factRow(ctx, m, true)));
    aboutYouSection.hidden = !facts.length;
    renderAllClear();
  };

  const renderConnectorRequests = () => {
    const requests = ctx.live.connectorRequests.value;
    replace(connectorsBox, ...requests.map((r) => connectorRequestCard(ctx, r)));
    connectorsSection.hidden = !requests.length;
    renderAllClear();
  };

  const renderAllClear = () => {
    const pending = ctx.live.pairings.value.length + ctx.live.secretRequests.value.length + waiting().length + openNotices().length + ctx.live.loopDrafts.value.length + ctx.live.aboutYou.value.length + ctx.live.connectorRequests.value.length;
    // Until the first answer, a skeleton: "nothing needs you" would be a guess, and pushed away a moment later.
    const loaded = ctx.live.inboxLoaded.value;
    allClear.hidden = loaded && pending > 0;
    replace(
      allClear,
      !loaded
        ? card({ flush: true }, skeletonRows(2, { avatar: true }))
        : pending === 0
        ? card(
            { flush: true },
            empty({
              icon: "check-circle",
              title: "Nothing needs you",
              body: "When a device asks to join, Galahad needs a credential or a connector, or wants to do something his oath says to ask about, or the heartbeat spots trouble, it waits here.",
              actions: admin ? button("Pair a device", { icon: "plus", onClick: () => openInvite(ctx, "client") }) : null,
            }),
          )
        : null,
    );
  };

  const pairingsSection = section("Devices asking to join", {}, pairingsBox);
  const actionsSection = section(
    "Galahad asks your leave",
    { note: "Anything outward, and every delete, waits for you unless a standing order answers it. Approved, it's sent once; no answer in 24 hours means no." },
    actionsBox,
  );
  const requestsSection = section("Credentials Galahad asked for", {}, requestsBox);
  const go = (text: string, place: string) => linkButton(text, `#/${place}`, { variant: "ghost", size: "sm", next: true });
  const connectorsSection = section(
    "Connectors asked for",
    { actions: go("Connectors", "connectors"), note: "A service Galahad or a knight needs and doesn't have. Asking installs nothing; once you add it, every one of them can use it." },
    connectorsBox,
  );
  const draftsSection = section("Loops Galahad drafted", { actions: go("Loops", "loops"), note: "You asked in chat for something on a schedule. Each runs only once you add it." }, draftsBox);
  const aboutYouBox = h("div", { class: "card rows" });
  const aboutYouSection = section(
    "Facts he noticed about you",
    { actions: go("Memory", "memory"), note: "Each goes with every answer of his once you keep it, in your words if you like. Until then it is only his note." },
    aboutYouBox,
  );
  const noticesSection = section("Noticed", { actions: go("Loops", "loops") }, noticesBox);
  // Kept across re-renders so it stays open while the outbox changes.
  const history = disclosure(historySummary, { flush: true, hidden: true }, historyRows);

  replace(
    root,
    h(
      "div",
      { class: "page narrow" },
      pageHead("Inbox", "Everything that needs you. Nothing here happens without your say."),
      // Shown whole once the Inbox has been read: what waits comes in at once, not section by section.
      pageBody(allClear, pairingsSection, actionsSection, requestsSection, connectorsSection, draftsSection, aboutYouSection, noticesSection, read ? history : null),
    ),
  );

  scope.add(ctx.live.pairings.subscribe(renderPairings));
  scope.add(ctx.live.secretRequests.subscribe(renderRequests));
  scope.add(ctx.live.loopDrafts.subscribe(renderDrafts));
  scope.add(ctx.live.connectorRequests.subscribe(renderConnectorRequests));
  scope.add(ctx.live.aboutYou.subscribe(renderAboutYou));
  scope.add(ctx.live.actions.subscribe(renderActions));
  scope.add(ctx.live.notices.subscribe(renderNotices));
  scope.add(ctx.live.inboxLoaded.subscribe(renderAllClear));
  renderPairings();
  renderRequests();
  renderDrafts();
  renderConnectorRequests();
  renderAboutYou();
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
