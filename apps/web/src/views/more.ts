import type { View } from "../context.ts";
import { moreIndex, placesFor } from "../lib/nav.ts";
import { pageHead, section } from "../ui/controls.ts";
import { h, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";

/* More: every place that isn't Chat, Squires or the Inbox, as one plain index. Only what this device may see. */

export const moreView: View = (root, ctx) => {
  replace(
    root,
    h(
      "div",
      { class: "page narrow" },
      pageHead("More", "Everything else, in one place."),
      ...moreIndex(placesFor(ctx.can)).map((group) =>
        section(
          group.heading,
          {},
          h(
            "nav",
            { class: "card rows", "aria-label": group.heading },
            ...group.places.map((place) =>
              h(
                "a",
                { class: "item center", href: `#/${place.id}` },
                h("span", { class: "avatar" }, icon(place.icon, { size: 16 })),
                h("span", { class: "grow" }, h("span", { class: "strong" }, place.label), h("span", { class: "more-about" }, place.about)),
                icon("chevron-right", { size: 14, class: "subtle" }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
};
