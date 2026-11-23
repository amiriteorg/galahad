import type { Ctx } from "../context.ts";
import { isWaiting } from "../live.ts";
import { plural } from "../lib/text.ts";
import { h, replace, type Scope } from "../ui/dom.ts";
import { connectorRequestCard } from "./connectors.ts";
import { actionCard, questionCard } from "./inbox.ts";
import { secretRequestCard } from "./vault.ts";

/*
 * What Galahad asks you, under his orb as you come to him (your word, 23 November 2026: he is the one you talk to and
 * hear from, for nearly everything): the approvals the oath leaves to you (his and the knights', each saying who asked),
 * the keys and connectors he asked for, and what services ask you in the middle of his calls, each answered here. The
 * Inbox still holds all of it, and the rest: devices asking to join, notices, drafts, facts about you.
 */

/** At most this many here; the rest are counted, a tap from the Inbox. */
const SHOWN = 4;

export function galahadAsks(ctx: Ctx, scope: Scope): HTMLElement {
  const box = h("section", { class: "galahad-asks stack", "aria-label": "Galahad asks you", hidden: true });
  const render = (): void => {
    const cards = [
      ...ctx.live.actions.value.filter((action) => isWaiting(action)).map((action) => actionCard(ctx, action)),
      ...ctx.live.secretRequests.value.map((request) => secretRequestCard(ctx, request)),
      ...ctx.live.connectorRequests.value.map((request) => connectorRequestCard(ctx, request)),
      ...ctx.live.questions.value.filter((question) => question.expires > Date.now()).map((question) => questionCard(ctx, question)),
    ];
    box.hidden = cards.length === 0;
    const more = cards.length - SHOWN;
    replace(
      box,
      cards.length ? h("h3", { class: "small strong" }, "Galahad asks you") : null,
      ...cards.slice(0, SHOWN),
      more > 0 ? h("a", { class: "small", href: "#/inbox" }, `${plural(more, "more", "more")} in the Inbox`) : null,
    );
  };
  for (const watched of [ctx.live.actions, ctx.live.secretRequests, ctx.live.connectorRequests, ctx.live.questions]) scope.add(watched.subscribe(render));
  render();
  return box;
}
