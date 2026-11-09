import type { View } from "../context.ts";
import { button, empty, pageHead, section } from "../ui/controls.ts";
import { h, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { openInvite, pairingCard } from "./fleet.ts";
import { secretRequestCard } from "./vault.ts";

/*
 * Everything that needs the owner, in one place: devices asking to join,
 * credentials Galahad asked for, and (soon) actions his oath makes him ask
 * about. Approvals scale with stakes: a phone is one click after comparing
 * codes; a machine asks once more; deleting anything persistent will always ask.
 */

export const inboxView: View = (root, ctx, { scope }) => {
  const pairingsBox = h("div", { class: "stack" });
  const requestsBox = h("div", { class: "stack" });
  const allClear = h("div");
  const admin = ctx.can("fleet:admin");
  const vault = ctx.can("vault:read");

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
  const renderAllClear = () => {
    const pairings = ctx.live.pairings.value;
    const requests = ctx.live.secretRequests.value;
    replace(
      allClear,
      pairings.length + requests.length === 0
        ? h(
            "div",
            { class: "card" },
            empty({
              icon: "check-circle",
              title: "Nothing needs you",
              body: "When a device asks to join, Galahad needs a credential, or his oath asks your leave, it waits here.",
              actions: admin ? button("Pair a device", { icon: "plus", onClick: () => openInvite(ctx, "client") }) : null,
            }),
          )
        : null,
    );
  };

  const pairingsSection = section("Devices asking to join", {}, pairingsBox);
  const requestsSection = section("Credentials Galahad asked for", {}, requestsBox);
  const oathSection = section(
    "Oath approvals",
    {},
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "card-body row top" },
        h("span", { class: "avatar agent" }, icon("shield", { size: 16 })),
        h(
          "div",
          { class: "grow stack tight" },
          h("div", { class: "strong small" }, "Nothing to approve"),
          h(
            "p",
            { class: "small muted" },
            "Galahad creates freely but asks before anything outward or destructive: pushing, sending, deleting a bucket, a repository or a persistent sandbox. Those requests will appear here, with what he wants to do, why, and what it touches.",
          ),
          h("div", { class: "row wrap tiny subtle" }, icon("info", { size: 13 }), "Approvals from the oath gate arrive with an upcoming update."),
        ),
      ),
    ),
  );

  replace(
    root,
    h(
      "div",
      { class: "page narrow" },
      pageHead("Inbox", "Everything that needs you. Nothing here happens without your say."),
      allClear,
      pairingsSection,
      requestsSection,
      oathSection,
    ),
  );

  scope.add(ctx.live.pairings.subscribe(renderPairings));
  scope.add(ctx.live.secretRequests.subscribe(renderRequests));
  renderPairings();
  renderRequests();
  void ctx.live.refreshInbox();
  scope.interval(() => void ctx.live.refreshInbox(), 2000);
};
