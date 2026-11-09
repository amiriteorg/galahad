import type { ProviderView } from "@galahad/core";
import { errorMessage, type PresetView, type View } from "../context.ts";
import { badge, copy, h, notice, replace, toast } from "../dom.ts";

interface RoleSpec {
  models: string[];
  configured: boolean;
  description: string;
}

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export const modelsView: View = (root, ctx) => {
  const providersBox = h("div");
  const rosterBox = h("div");
  const status = h("div");
  let presets: PresetView[] = [];

  function providerItem(p: ProviderView): HTMLElement {
    const modelsBox = h("div");
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(p.baseUrl);
    return h(
      "li",
      {},
      h(
        "div",
        { class: "row" },
        h("strong", {}, p.id),
        badge(p.kind),
        p.hasKey ? badge("key sealed", "ok") : local ? badge("local", "accent") : badge("no key", "warn"),
        h("span", { class: "grow" }),
        h(
          "button",
          {
            class: "btn small",
            type: "button",
            onclick: async () => {
              replace(modelsBox, h("p", { class: "small muted" }, "Asking the provider…"));
              try {
                const { models } = await ctx.api.post<{ models: string[] }>("/api/providers/models", { id: p.id });
                replace(
                  modelsBox,
                  models.length
                    ? h(
                        "ul",
                        { class: "list small", style: "margin-top:8px;max-height:240px;overflow:auto" },
                        ...models.map((m) =>
                          h(
                            "li",
                            { class: "row", style: "padding:6px 0" },
                            h("span", { class: "mono grow" }, `${p.id}/${m}`),
                            h("button", { class: "btn small", type: "button", onclick: () => copy(`${p.id}/${m}`) }, "Copy"),
                          ),
                        ),
                      )
                    : h("p", { class: "small muted" }, "The provider listed no models."),
                );
              } catch (error) {
                replace(modelsBox, notice(errorMessage(error), "error"));
              }
            },
          },
          "List models",
        ),
      ),
      h("div", { class: "mono muted", style: "margin-top:4px" }, p.baseUrl),
      p.label ? h("div", { class: "small muted" }, p.label) : null,
      modelsBox,
    );
  }

  function roleEditor(role: string, spec: RoleSpec): HTMLElement {
    const field = h("textarea", { rows: Math.max(2, spec.models.length), spellcheck: "false", "aria-label": `Models for ${role}`, class: "mono" });
    field.value = spec.models.join("\n");
    const save = h(
      "button",
      {
        class: "btn small primary",
        type: "button",
        disabled: !ctx.can("brain:write"),
        onclick: async () => {
          const models = field.value
            .split(/[\n,]/)
            .map((m) => m.trim())
            .filter(Boolean);
          if (models.some((m) => !/^[^/\s]+\/\S+$/.test(m))) {
            toast("Each model must look like provider/model (one per line).", "error");
            return;
          }
          try {
            await ctx.api.post("/api/roster", { role, models });
            toast(`${role} updated on every node.`);
            await refresh();
          } catch (error) {
            toast(errorMessage(error), "error");
          }
        },
      },
      "Save",
    );
    return h(
      "li",
      {},
      h("div", { class: "row" }, h("strong", {}, role), spec.configured ? null : badge("default"), h("span", { class: "small muted grow" }, spec.description)),
      h("div", { style: "margin-top:6px" }, field),
      h("div", { class: "row small muted", style: "margin-top:6px" }, h("span", { class: "grow" }, "First answers; the rest are fallbacks. provider/* means “whatever that local runtime serves”."), save),
    );
  }

  const addId = h("input", { type: "text", id: "provider-id", autocomplete: "off", spellcheck: "false", placeholder: "e.g. verda" });
  const addPreset = h("select", { id: "provider-preset" }, h("option", { value: "" }, "No preset"));
  const addUrl = h("input", { type: "url", id: "provider-url", autocomplete: "off", spellcheck: "false", placeholder: "https://…/v1" });
  const addKind = h("select", { id: "provider-kind" }, h("option", { value: "openai" }, "OpenAI-compatible"), h("option", { value: "anthropic" }, "Anthropic"));
  const addSecret = h("input", { type: "text", id: "provider-secret", autocomplete: "off", spellcheck: "false", placeholder: "vault secret name (defaults to the id)" });
  const addStatus = h("div");

  addPreset.addEventListener("change", () => {
    const preset = presets.find((p) => p.id === addPreset.value);
    if (!preset) return;
    if (!addId.value) addId.value = preset.id;
    addKind.value = preset.kind;
    addUrl.value = preset.baseUrl;
    if (preset.note) replace(addStatus, notice(preset.note, "info"));
  });

  async function addProvider(event: Event): Promise<void> {
    event.preventDefault();
    const id = addId.value.trim();
    if (!NAME_RE.test(id)) {
      replace(addStatus, notice("Give the provider an id (letters, digits and . _ : -).", "warn"));
      return;
    }
    const secret = addSecret.value.trim() || id;
    try {
      await ctx.api.post("/api/providers", {
        id,
        ...(addPreset.value ? { preset: addPreset.value } : {}),
        ...(addUrl.value.trim() ? { baseUrl: addUrl.value.trim() } : {}),
        kind: addKind.value,
        secret,
      });
      replace(addStatus, notice(`Provider ${id} configured. Its key is read from the vault secret "${secret}" — add it on the Vault page if you haven't.`, "ok"));
      addId.value = "";
      addUrl.value = "";
      addSecret.value = "";
      await refresh();
    } catch (error) {
      replace(addStatus, notice(errorMessage(error), "error"));
    }
  }

  async function refresh(): Promise<void> {
    replace(status);
    try {
      const [{ providers, presets: loadedPresets }, { roster }] = await Promise.all([
        ctx.api.get<{ providers: ProviderView[]; presets: PresetView[] }>("/api/providers"),
        ctx.api.get<{ roster: Record<string, RoleSpec> }>("/api/roster"),
      ]);
      presets = loadedPresets;
      replace(addPreset, h("option", { value: "" }, "No preset"), ...presets.map((p) => h("option", { value: p.id }, p.id)));
      replace(
        providersBox,
        providers.length
          ? h("ul", { class: "list" }, ...providers.map(providerItem))
          : h("p", { class: "muted" }, "No providers yet. Adding a key on the Vault page configures known providers automatically."),
      );
      replace(rosterBox, h("ul", { class: "list" }, ...Object.entries(roster).map(([role, spec]) => roleEditor(role, spec))));
    } catch (error) {
      replace(status, notice(errorMessage(error), "error"));
    }
  }

  replace(
    root,
    h("h1", {}, "Models"),
    h("p", { class: "lede" }, "Models are hired by role, not by vendor. The roster is shared by every node; keys stay sealed in the vault."),
    status,
    h("div", { class: "card" }, h("h2", {}, "Roster"), rosterBox),
    h("div", { class: "card" }, h("h2", {}, "Providers"), providersBox),
    ctx.can("brain:write")
      ? h(
          "form",
          { class: "card stack", onsubmit: (event: Event) => void addProvider(event) },
          h("h2", {}, "Add or update a provider"),
          h("div", { class: "row" }, h("div", { class: "grow" }, h("label", { for: "provider-id" }, "Id"), addId), h("div", { class: "grow" }, h("label", { for: "provider-preset" }, "Preset"), addPreset)),
          h("div", {}, h("label", { for: "provider-url" }, "Base URL"), addUrl),
          h("div", { class: "row" }, h("div", { class: "grow" }, h("label", { for: "provider-kind" }, "API"), addKind), h("div", { class: "grow" }, h("label", { for: "provider-secret" }, "Key from vault secret"), addSecret)),
          h("div", { class: "row" }, h("button", { class: "btn primary", type: "submit" }, "Save provider")),
          addStatus,
        )
      : null,
  );
  void refresh();
};
