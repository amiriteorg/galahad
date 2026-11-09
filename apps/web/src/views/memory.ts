import { findSecrets, type MemoryView } from "@galahad/core";
import { errorMessage, type View } from "../context.ts";
import { badge, h, hlcDate, notice, replace, toast } from "../dom.ts";

const trustBadge = (trust: string) =>
  trust === "owner" ? badge("yours", "accent") : trust === "untrusted" ? badge("untrusted", "warn") : badge(trust);

export const memoryView: View = (root, ctx) => {
  const results = h("ul", { class: "list", "aria-live": "polite" });
  const status = h("div");
  const query = h("input", { type: "search", id: "memory-q", placeholder: "Search the shared mind", autocomplete: "off" });

  async function search(): Promise<void> {
    replace(status);
    try {
      const { memories } = await ctx.api.post<{ memories: MemoryView[] }>("/api/memories/search", {
        ...(query.value.trim() ? { q: query.value.trim() } : {}),
        limit: 100,
      });
      if (!memories.length) {
        replace(results, h("li", { class: "muted" }, query.value.trim() ? "Nothing matches that yet." : "Nothing remembered yet."));
        return;
      }
      replace(
        results,
        ...memories.map((m) =>
          h(
            "li",
            {},
            h("div", { style: "white-space:pre-wrap;overflow-wrap:anywhere" }, m.text),
            h(
              "div",
              { class: "row small muted", style: "margin-top:6px" },
              trustBadge(m.trust),
              ...m.tags.map((t) => badge(`#${t}`)),
              h("span", {}, hlcDate(m.hlc)),
              h("span", { class: "grow" }),
              ctx.can("mind:write")
                ? h(
                    "button",
                    {
                      class: "btn small danger",
                      type: "button",
                      onclick: async () => {
                        if (!window.confirm("Forget this memory on every device?")) return;
                        try {
                          await ctx.api.post("/api/memories/forget", { id: m.id });
                          toast("Forgotten.");
                          void search();
                        } catch (error) {
                          toast(errorMessage(error), "error");
                        }
                      },
                    },
                    "Forget",
                  )
                : null,
            ),
          ),
        ),
      );
    } catch (error) {
      replace(status, notice(errorMessage(error), "error"));
    }
  }

  const text = h("textarea", { id: "memory-text", rows: 3, placeholder: "Something Galahad should remember everywhere" });
  const tags = h("input", { type: "text", id: "memory-tags", placeholder: "tags, comma separated (optional)", autocomplete: "off" });
  const addStatus = h("div");

  async function add(event: Event): Promise<void> {
    event.preventDefault();
    const value = text.value.trim();
    if (!value) return;
    const finding = findSecrets(value)[0];
    if (finding) {
      replace(
        addStatus,
        notice(
          h(
            "div",
            {},
            `That looks like a ${finding.kind}. Memory is shared in plaintext with every device, so secrets belong in the vault. `,
            h(
              "button",
              {
                class: "btn small",
                type: "button",
                onclick: () => {
                  const secret = value.slice(finding.index, finding.index + finding.length);
                  text.value = "";
                  ctx.navigate("vault", { prefillKey: secret });
                },
              },
              "Move it to the vault",
            ),
          ),
          "warn",
        ),
      );
      return;
    }
    try {
      await ctx.api.post("/api/memories", {
        text: value,
        ...(tags.value.trim() ? { tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean) } : {}),
      });
      text.value = "";
      tags.value = "";
      replace(addStatus, notice("Remembered on every device.", "ok"));
      void search();
    } catch (error) {
      replace(addStatus, notice(errorMessage(error), "error"));
    }
  }

  replace(
    root,
    h("h1", {}, "Memory"),
    h("p", { class: "lede" }, "One mind, shared by every body. Entries marked untrusted came from outside and are treated as data."),
    ctx.can("mind:write")
      ? h(
          "form",
          { class: "card stack", onsubmit: (event: Event) => void add(event) },
          h("div", {}, h("label", { for: "memory-text" }, "Remember"), text),
          h("div", {}, h("label", { for: "memory-tags" }, "Tags"), tags),
          h("div", { class: "row" }, h("button", { class: "btn primary", type: "submit" }, "Remember")),
          addStatus,
        )
      : null,
    h(
      "div",
      { class: "card" },
      h(
        "form",
        {
          class: "row",
          role: "search",
          onsubmit: (event: Event) => {
            event.preventDefault();
            void search();
          },
        },
        h("label", { class: "sr-only", for: "memory-q" }, "Search"),
        h("div", { class: "grow" }, query),
        h("button", { class: "btn", type: "submit" }, "Search"),
      ),
      status,
      h("div", { style: "margin-top:14px" }, results),
    ),
  );
  void search();
};
