import type { View } from "../context.ts";
import { moreIndex, placesFor } from "../lib/nav.ts";
import { list, listRow, pageHead, section } from "../ui/controls.ts";
import { h, replace } from "../ui/dom.ts";

/* More: every place that isn't Chat, the Roundtable or the Inbox, as one plain index. Only what this device may see. */

export const moreView: View = (root, ctx) => {
  replace(
    root,
    h(
      "div",
      { class: "page narrow" },
      pageHead("More", "Everything else, in one place."),
      ...moreIndex(placesFor(ctx.can)).map((group) =>
        section(group.heading, {}, list(group.places.map((place) => listRow({ lead: place.icon, title: place.label, sub: place.about, href: `#/${place.id}`, chevron: true })), { nav: group.heading })),
      ),
    ),
  );
};
