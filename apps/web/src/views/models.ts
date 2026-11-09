import type { ProviderView } from "@galahad/core";
import { findSecrets } from "@galahad/core/secret-scan";
import { type Ctx, errorMessage, type View } from "../context.ts";
import type { PresetView, RoleSpec } from "../types.ts";
import { badge, busy, button, callout, copyText, empty, errorState, field, pageHead, section, segmented, skeletonBlock } from "../ui/controls.ts";
import { confirmAction, openSheet } from "../ui/dialog.ts";
import { h, nextId, replace } from "../ui/dom.ts";
import { icon, type IconName } from "../ui/icons.ts";
import { toast } from "../ui/toast.ts";
import { openAddKey } from "./vault.ts";

/*
 * Models are hired by role, not by vendor. The roster (shared by every node)
 * lists, per role, the model to use first and the fallbacks after it.
 * Providers say where models live; their keys stay sealed in the vault.
 */

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const REF_RE = /^[^/\s]+\/\S+$/;
const ROLE_ICON: Record<string, IconName> = { planner: "compass", engineer: "code", reviewer: "review", swift: "zap" };

export const modelsView: View = (root, ctx, { scope }) => {
  const write = ctx.can("brain:write");
  const rosterBox = h("div", { class: "grid wide", style: "grid-template-columns:repeat(auto-fill,minmax(min(100%,440px),1fr))" }, skeletonBlock(200), skeletonBlock(200));
  const providersBox = h("div", { class: "card" }, skeletonBlock(120));
  const knownModels = h("datalist", { id: nextId("models") });
  let roster: Record<string, RoleSpec> = {};
  let presets: PresetView[] = [];
  const drafts = new Map<string, string[]>();

  function addKnown(refs: string[]): void {
    const have = new Set([...knownModels.options].map((o) => o.value));
    for (const ref of refs) if (!have.has(ref)) knownModels.append(h("option", { value: ref }));
  }

  function roleCard(role: string, spec: RoleSpec): HTMLElement {
    const list = h("div", { class: "reorder", role: "list", "aria-label": `Models for ${role}` });
    const foot = h("div", { class: "card-foot", hidden: true });
    const input = h("input", { class: "input mono", type: "text", placeholder: "provider/model", list: knownModels.id, autocomplete: "off", spellcheck: "false", "aria-label": `Add a model to ${role}` });
    const draft = () => drafts.get(role) ?? [...spec.models];
    const dirty = () => JSON.stringify(draft()) !== JSON.stringify(spec.models);

    function render(): void {
      const models = draft();
      replace(
        list,
        ...(models.length
          ? models.map((ref, i) =>
              h(
                "div",
                { class: "r-item", role: "listitem" },
                h("span", { class: "r-index", "aria-hidden": "true" }, String(i + 1)),
                h("span", { class: "mono small grow ellipsis", title: `${ref} · ${i === 0 ? "answers first" : `fallback ${i}`}` }, ref),
                write
                  ? [
                      button(`Move ${ref} up`, { variant: "ghost", size: "sm", iconOnly: true, icon: "chevron-up", disabled: i === 0, onClick: () => move(i, -1) }),
                      button(`Move ${ref} down`, { variant: "ghost", size: "sm", iconOnly: true, icon: "chevron-down", disabled: i === models.length - 1, onClick: () => move(i, 1) }),
                      button(`Remove ${ref}`, { variant: "ghost", size: "sm", iconOnly: true, icon: "x", onClick: () => remove(i) }),
                    ]
                  : null,
              ),
            )
          : [h("p", { class: "small subtle" }, "No models: this role can't answer.")]),
      );
      foot.hidden = !dirty();
    }
    function set(models: string[]): void {
      drafts.set(role, models);
      render();
    }
    function move(i: number, delta: number): void {
      const models = draft();
      const [item] = models.splice(i, 1);
      models.splice(i + delta, 0, item!);
      set(models);
      list.querySelectorAll<HTMLButtonElement>(".r-item")[i + delta]?.querySelector<HTMLButtonElement>(`button[aria-label^="Move ${CSS.escape(item!)} ${delta < 0 ? "up" : "down"}"]`)?.focus();
    }
    function remove(i: number): void {
      const models = draft();
      models.splice(i, 1);
      set(models);
    }
    function add(): void {
      const ref = input.value.trim();
      if (!ref) return;
      if (!REF_RE.test(ref)) {
        toast("Use provider/model", { tone: "warn", description: "For example anthropic/claude-opus-5-5, or ollama/* for whatever a local runtime serves." });
        return;
      }
      if (draft().includes(ref)) return void (input.value = "");
      set([...draft(), ref]);
      input.value = "";
    }

    const save = button("Save", { variant: "primary", size: "sm", icon: "check" });
    save.addEventListener("click", () =>
      void busy(save, async () => {
        try {
          const result = await ctx.api.post<{ roster: Record<string, RoleSpec> }>("/api/roster", { role, models: draft() });
          roster = result.roster;
          drafts.delete(role);
          spec.models = roster[role]?.models ?? draft();
          spec.configured = true;
          render();
          toast(`${role} updated on every node`, { tone: "ok" });
        } catch (error) {
          toast("Couldn't save the roster", { tone: "error", description: errorMessage(error) });
        }
      }),
    );
    replace(foot, h("span", { class: "tiny subtle grow" }, "Unsaved changes"), button("Revert", { size: "sm", variant: "ghost", onClick: () => (drafts.delete(role), render()) }), save);

    render();
    return h(
      "article",
      { class: "card" },
      h(
        "div",
        { class: "card-head" },
        h("span", { style: "color:var(--accent)" }, icon(ROLE_ICON[role] ?? "sparkle", { size: 16 })),
        h("div", { class: "grow" }, h("h3", {}, role), h("div", { class: "tiny subtle" }, spec.description)),
        spec.configured ? null : badge("default", "neutral"),
      ),
      h(
        "div",
        { class: "card-body stack" },
        list,
        write
          ? h(
              "form",
              {
                class: "row",
                onsubmit: (event: Event) => {
                  event.preventDefault();
                  add();
                },
              },
              h("div", { class: "grow" }, input),
              button("Add", { size: "sm", type: "submit", icon: "plus" }),
            )
          : null,
      ),
      foot,
    );
  }

  function providerRow(p: ProviderView): HTMLElement {
    const modelsBox = h("div");
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(p.baseUrl);
    const keyBadge = p.hasKey ? badge("key sealed", "ok", "check") : local ? badge("local", "accent") : badge("no key", "warn", "alert");
    const list = button("List models", { size: "sm", variant: "ghost", icon: "models" });
    list.addEventListener("click", () =>
      void busy(list, async () => {
        try {
          const { models } = await ctx.api.post<{ models: string[] }>("/api/providers/models", { id: p.id });
          const refs = models.map((m) => `${p.id}/${m}`);
          addKnown(refs);
          replace(
            modelsBox,
            refs.length
              ? h(
                  "div",
                  { class: "stack tight", style: "margin-top:10px;max-height:280px;overflow:auto" },
                  h("div", { class: "tiny subtle" }, `${refs.length} models · type them into a role above, or copy`),
                  ...refs.map((ref) =>
                    h("div", { class: "row", style: "gap:4px" }, h("span", { class: "mono small grow ellipsis" }, ref), button(`Copy ${ref}`, { size: "sm", variant: "ghost", iconOnly: true, icon: "copy", onClick: () => void copyText(ref) })),
                  ),
                )
              : h("p", { class: "small subtle", style: "margin-top:8px" }, "The provider listed no models."),
          );
        } catch (error) {
          replace(modelsBox, h("div", { style: "margin-top:8px" }, callout("danger", errorMessage(error))));
        }
      }),
    );
    return h(
      "div",
      { class: "item" },
      h("span", { class: "avatar" }, icon(local ? "server" : "globe", { size: 16 })),
      h(
        "div",
        { class: "grow" },
        h("div", { class: "row wrap" }, h("span", { class: "strong" }, p.id), badge(p.kind === "anthropic" ? "Anthropic API" : "OpenAI-compatible", "neutral"), keyBadge),
        h("div", { class: "meta" }, h("span", { class: "mono" }, p.baseUrl), p.label ? h("span", {}, p.label) : null, p.secret ? h("span", {}, "key: ", h("span", { class: "mono" }, p.secret)) : null),
        modelsBox,
      ),
      h(
        "div",
        { class: "item-actions" },
        list,
        !p.hasKey && !local && ctx.can("vault:write") ? button("Add key", { size: "sm", icon: "key", onClick: () => openAddKey(ctx, { provider: p.id, name: p.secret ?? p.id }) }) : null,
        write
          ? button(`Remove ${p.id}`, {
              size: "sm",
              variant: "ghost",
              iconOnly: true,
              icon: "trash",
              onClick: async () => {
                const ok = await confirmAction({
                  title: `Remove ${p.id}?`,
                  body: "Roles that use its models fall back to the next one in their list. Its key stays in the vault.",
                  confirmLabel: "Remove provider",
                });
                if (!ok) return;
                try {
                  await ctx.api.post("/api/providers/remove", { id: p.id });
                  toast(`${p.id} removed`, { tone: "ok" });
                  void refresh();
                } catch (error) {
                  toast("Couldn't remove it", { tone: "error", description: errorMessage(error) });
                }
              },
            })
          : null,
      ),
    );
  }

  async function refresh(): Promise<void> {
    try {
      const [providers, rosterResponse] = await Promise.all([
        ctx.api.get<{ providers: ProviderView[]; presets: PresetView[] }>("/api/providers", scope.signal),
        ctx.api.get<{ roster: Record<string, RoleSpec> }>("/api/roster", scope.signal),
      ]);
      if (scope.disposed) return;
      presets = providers.presets;
      roster = rosterResponse.roster;
      addKnown(Object.values(roster).flatMap((r) => r.models));
      replace(rosterBox, ...Object.entries(roster).map(([role, spec]) => roleCard(role, spec)));
      replace(
        providersBox,
        providers.providers.length
          ? h("div", { class: "rows" }, ...providers.providers.map(providerRow))
          : empty({
              icon: "models",
              title: "No providers yet",
              body: "Adding a key in the vault configures known providers for you. Local runtimes like Ollama need only their address.",
              actions: [ctx.can("vault:write") ? button("Add a key", { variant: "primary", icon: "key", onClick: () => openAddKey(ctx) }) : null, write ? button("Add provider", { icon: "plus", onClick: () => openAddProvider(ctx, presets, refresh) }) : null],
            }),
      );
    } catch (error) {
      if (!scope.disposed) replace(rosterBox, errorState("Couldn't load models", error, () => void refresh()));
    }
  }

  replace(
    root,
    h(
      "div",
      { class: "page" },
      pageHead("Models", "Hired by role, not by vendor. The roster is shared by every node; keys stay sealed in the vault.", write ? button("Add provider", { icon: "plus", onClick: () => openAddProvider(ctx, presets, refresh) }) : null),
      write ? null : callout("quiet", "This device can see the roster but not change it (no brain:write scope)."),
      section("Roster", {}, rosterBox, h("p", { class: "tiny subtle" }, "The first model answers; the rest are fallbacks, tried in order. ", h("span", { class: "mono" }, "provider/*"), " means whatever that local runtime serves.")),
      section("Providers", {}, providersBox),
      knownModels,
    ),
  );
  void refresh();
};

function openAddProvider(ctx: Ctx, presets: PresetView[], onDone: () => Promise<void>): void {
  const id = h("input", { class: "input mono", type: "text", autocomplete: "off", spellcheck: "false", autocapitalize: "off", placeholder: "e.g. verda" });
  const preset = h("select", { class: "select" }, h("option", { value: "" }, "No preset"), ...presets.map((p) => h("option", { value: p.id }, p.id)));
  const url = h("input", { class: "input mono", type: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://…/v1" });
  const secret = h("input", { class: "input mono", type: "text", autocomplete: "off", spellcheck: "false", placeholder: "defaults to the id", maxlength: 128 });
  const label = h("input", { class: "input", type: "text", autocomplete: "off", maxlength: 128 });
  let kind: "openai" | "anthropic" = "openai";
  const kindControl = segmented(
    [
      { value: "openai", label: "OpenAI-compatible" },
      { value: "anthropic", label: "Anthropic" },
    ],
    kind,
    (value) => (kind = value as typeof kind),
    { label: "API", block: true },
  );
  const status = h("div");
  preset.addEventListener("change", () => {
    const chosen = presets.find((p) => p.id === preset.value);
    if (!chosen) return;
    if (!id.value) id.value = chosen.id;
    kind = chosen.kind;
    kindControl.set(chosen.kind);
    url.value = chosen.baseUrl;
    replace(status, chosen.note ? callout("info", chosen.note) : null);
  });
  const save = button("Save provider", { variant: "primary", type: "submit", icon: "check" });
  const form = h(
    "form",
    {
      class: "stack loose",
      onsubmit: (event: Event) => {
        event.preventDefault();
        // Provider settings replicate in plaintext: a key pasted into any of these fields stops here.
        for (const input of [id, url, secret, label]) {
          const finding = findSecrets(input.value)[0];
          if (!finding) continue;
          const key = input.value.slice(finding.index, finding.index + finding.length);
          input.value = "";
          replace(
            status,
            callout("warn", `That looks like a ${finding.kind}. Provider settings are shared in plaintext, so it wasn't saved. This form wants the vault secret's name, not the key.`, {
              title: "Keys belong in the vault",
              icon: "shield",
              actions: ctx.can("vault:write")
                ? button("Store it in the vault instead", {
                    variant: "primary",
                    size: "sm",
                    icon: "vault",
                    onClick: () => {
                      sheet.close();
                      openAddKey(ctx, { prefill: key, provider: id.value.trim() || null });
                    },
                  })
                : null,
            }),
          );
          return;
        }
        const providerId = id.value.trim();
        if (!NAME_RE.test(providerId)) {
          replace(status, callout("warn", "Give the provider an id (letters, digits and . _ : -)."));
          return;
        }
        const secretName = secret.value.trim() || providerId;
        void busy(save, async () => {
          try {
            await ctx.api.post("/api/providers", {
              id: providerId,
              ...(preset.value ? { preset: preset.value } : {}),
              ...(url.value.trim() ? { baseUrl: url.value.trim() } : {}),
              kind,
              secret: secretName,
              ...(label.value.trim() ? { label: label.value.trim() } : {}),
            });
            sheet.close();
            toast(`${providerId} configured`, { tone: "ok", description: `Its key is read from the vault secret "${secretName}".` });
            await onDone();
          } catch (error) {
            replace(status, callout("danger", errorMessage(error)));
          }
        });
      },
    },
    h("div", { class: "fields" }, field("Preset", preset), field("Id", id)),
    field("Base URL", url, { hint: "The OpenAI- or Anthropic-compatible endpoint." }),
    h("div", { class: "stack tight" }, h("div", { class: "label" }, "API"), kindControl.el),
    h("div", { class: "fields" }, field("Vault secret name", secret, { hint: "The name of a secret in the vault, never the key itself." }), field("Label (optional)", label)),
    status,
    h("div", { class: "row", style: "justify-content:flex-end" }, button("Cancel", { onClick: () => sheet.close() }), save),
  );
  const sheet = openSheet({ title: "Add or update a provider", description: "Where models live. The key itself stays in the vault.", body: form });
}
