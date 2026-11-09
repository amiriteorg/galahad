import type { ProviderView, SecretRequestView, SecretView } from "@galahad/core";
import { errorMessage, type PresetView, type View } from "../context.ts";
import { badge, h, hlcDate, notice, replace, toast } from "../dom.ts";

/*
 * Keys go from this password field straight into the vault on a full node, where
 * they are sealed for your full nodes only. They are never stored in this browser,
 * never logged, never shown again, and never handed to a model: Galahad's tools
 * use scoped gateway tokens instead.
 */

interface ProvidersResponse {
  providers: ProviderView[];
  presets: PresetView[];
}

/** Longest matching key prefix wins (sk-orca- beats sk-). */
export function detectProvider(key: string, presets: PresetView[]): string | null {
  let best: { id: string; length: number } | null = null;
  for (const preset of presets) {
    for (const prefix of preset.keyPrefixes ?? []) {
      if (key.startsWith(prefix) && (!best || prefix.length > best.length)) best = { id: preset.id, length: prefix.length };
    }
  }
  return best?.id ?? null;
}

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export const vaultView: View = (root, ctx, opts) => {
  let presets: PresetView[] = [];
  let providers: ProviderView[] = [];
  let manualProvider = false;

  const value = h("input", {
    type: "password",
    id: "key-value",
    autocomplete: "off",
    spellcheck: "false",
    autocapitalize: "off",
    placeholder: "Paste the key here",
    "aria-describedby": "key-help",
  });
  const providerSelect = h("select", { id: "key-provider" }, h("option", { value: "" }, "Choose a provider…"));
  const name = h("input", { type: "text", id: "key-name", autocomplete: "off", spellcheck: "false", placeholder: "e.g. anthropic" });
  const label = h("input", { type: "text", id: "key-label", autocomplete: "off", placeholder: "optional, e.g. personal account" });
  const formStatus = h("div");
  const secretsList = h("ul", { class: "list" });
  const requestsBox = h("div");
  const listStatus = h("div");

  function syncProviderOptions(): void {
    const ids = new Set([...presets.map((p) => p.id), ...providers.map((p) => p.id)]);
    const current = providerSelect.value;
    replace(
      providerSelect,
      h("option", { value: "" }, "Choose a provider…"),
      ...[...ids].sort().map((id) => h("option", { value: id, selected: id === current }, id)),
      h("option", { value: "__other" }, "Other (secret only)"),
    );
  }

  function onKeyInput(): void {
    if (manualProvider) return;
    const detected = detectProvider(value.value.trim(), presets);
    if (detected) {
      providerSelect.value = detected;
      if (!name.value || presets.some((p) => p.id === name.value)) name.value = detected;
    }
  }

  async function ensureProviderConfigured(providerId: string, secretName: string): Promise<string | null> {
    if (!ctx.can("brain:write")) return null;
    const preset = presets.find((p) => p.id === providerId);
    const existing = providers.find((p) => p.id === providerId);
    if (existing?.secret === secretName) return null;
    if (existing) {
      await ctx.api.post("/api/providers", { id: providerId, kind: existing.kind, baseUrl: existing.baseUrl, secret: secretName });
      return `Provider ${providerId} now uses this key.`;
    }
    if (!preset) return null;
    if (!preset.baseUrl) return preset.note ?? `Add ${providerId}'s base URL on the Models page to start using it.`;
    await ctx.api.post("/api/providers", { id: providerId, secret: secretName });
    return `Provider ${providerId} configured.`;
  }

  async function seal(secretName: string, secretValue: string, providerId: string | null, secretLabel?: string): Promise<string> {
    await ctx.api.post("/api/secrets", {
      name: secretName,
      value: secretValue,
      ...(providerId ? { provider: providerId } : {}),
      ...(secretLabel ? { label: secretLabel } : {}),
    });
    const extra = providerId ? await ensureProviderConfigured(providerId, secretName) : null;
    return `Sealed into the vault${extra ? `. ${extra}` : "."} Every full node can use it; no model ever sees it.`;
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    // Read, then clear immediately: the key should live in this page as briefly as possible.
    const secretValue = value.value.trim();
    value.value = "";
    const chosen = providerSelect.value;
    const providerId = chosen && chosen !== "__other" ? chosen : null;
    const secretName = (name.value.trim() || providerId || "").trim();
    if (!secretValue) {
      replace(formStatus, notice("Please paste a key first.", "warn"));
      return;
    }
    if (!NAME_RE.test(secretName)) {
      replace(formStatus, notice("Give the secret a name (letters, digits and . _ : - only). Paste the key again, please.", "warn"));
      return;
    }
    try {
      const message = await seal(secretName, secretValue, providerId, label.value.trim() || undefined);
      replace(formStatus, notice(message, "ok"));
      label.value = "";
      manualProvider = false;
      await refresh();
    } catch (error) {
      replace(formStatus, notice(`${errorMessage(error)} — the field was cleared for safety; please paste it again.`, "error"));
    }
  }

  function requestCard(request: SecretRequestView): HTMLElement {
    const field = h("input", {
      type: "password",
      autocomplete: "off",
      spellcheck: "false",
      autocapitalize: "off",
      placeholder: "Paste it here",
      "aria-label": `Value for ${request.name}`,
    });
    const status = h("div");
    return h(
      "div",
      { class: "card", style: "border-color:var(--accent)" },
      h("div", { class: "row" }, badge("requested", "accent"), h("strong", {}, request.name), request.provider ? badge(request.provider) : null),
      h("p", { style: "margin-top:8px" }, request.purpose),
      h("p", { class: "small muted" }, `Asked ${hlcDate(request.requestedAt)}. Galahad will learn that it exists, never what it is.`),
      ctx.can("vault:write")
        ? h(
            "form",
            {
              class: "row",
              onsubmit: async (event: Event) => {
                event.preventDefault();
                const secretValue = field.value.trim();
                field.value = "";
                if (!secretValue) return;
                try {
                  replace(status, notice(await seal(request.name, secretValue, request.provider), "ok"));
                  await refresh();
                } catch (error) {
                  replace(status, notice(errorMessage(error), "error"));
                }
              },
            },
            h("div", { class: "grow" }, field),
            h("button", { class: "btn primary", type: "submit" }, "Seal"),
          )
        : null,
      status,
    );
  }

  async function refresh(): Promise<void> {
    replace(listStatus);
    try {
      const [secretsResponse, requestsResponse, providersResponse] = await Promise.all([
        ctx.api.get<{ secrets: SecretView[]; unlocked: boolean }>("/api/secrets"),
        ctx.api.get<{ requests: SecretRequestView[] }>("/api/secret-requests"),
        ctx.can("mind:read") ? ctx.api.get<ProvidersResponse>("/api/providers") : Promise.resolve({ providers: [], presets: [] }),
      ]);
      presets = providersResponse.presets;
      providers = providersResponse.providers;
      syncProviderOptions();
      if (value.value) onKeyInput(); // a key handed over from chat may arrive before the presets load
      if (!secretsResponse.unlocked) replace(listStatus, notice("This node holds no vault grant, so it cannot use these keys yet.", "warn"));
      replace(requestsBox, ...requestsResponse.requests.map(requestCard));
      if (!secretsResponse.secrets.length) {
        replace(secretsList, h("li", { class: "muted" }, "The vault is empty."));
        return;
      }
      replace(
        secretsList,
        ...secretsResponse.secrets.map((s) =>
          h(
            "li",
            { class: "row" },
            h(
              "div",
              { class: "grow" },
              h("div", { class: "row" }, h("strong", {}, s.name), s.provider ? badge(s.provider) : null, s.hint ? h("span", { class: "mono muted" }, s.hint) : null),
              h("div", { class: "small muted" }, [s.label, `updated ${hlcDate(s.updatedAt)}`].filter(Boolean).join(" · ")),
            ),
            ctx.can("vault:write")
              ? h(
                  "button",
                  {
                    class: "btn small danger",
                    type: "button",
                    onclick: async () => {
                      if (!window.confirm(`Delete the secret "${s.name}" from every node? Tools using it will stop working.`)) return;
                      try {
                        await ctx.api.post("/api/secrets/delete", { name: s.name });
                        toast("Deleted.");
                        await refresh();
                      } catch (error) {
                        toast(errorMessage(error), "error");
                      }
                    },
                  },
                  "Delete",
                )
              : null,
          ),
        ),
      );
    } catch (error) {
      replace(listStatus, notice(errorMessage(error), "error"));
    }
  }

  value.addEventListener("input", onKeyInput);
  providerSelect.addEventListener("change", () => {
    manualProvider = true;
    if (providerSelect.value && providerSelect.value !== "__other") name.value = providerSelect.value;
  });

  const rotate = h(
    "button",
    {
      class: "btn small",
      type: "button",
      onclick: async () => {
        if (!window.confirm("Rotate the vault key? Every secret is re-sealed for the current full nodes.")) return;
        try {
          const result = await ctx.api.post<{ resealed: string[] }>("/api/vault/rotate", {});
          toast(`Vault rotated; ${result.resealed.length} secrets re-sealed.`);
        } catch (error) {
          toast(errorMessage(error), "error");
        }
      },
    },
    "Rotate vault key",
  );

  replace(
    root,
    h("h1", {}, "Vault"),
    h(
      "p",
      { class: "lede" },
      "Add a key once and every full node can use it. Keys are sealed for your machines only — never shown again, never stored in this browser, never seen by Galahad's models.",
    ),
    requestsBox,
    ctx.can("vault:write")
      ? h(
          "form",
          { class: "card stack", onsubmit: (event: Event) => void submit(event), autocomplete: "off" },
          h("h2", {}, "Add a key"),
          h(
            "div",
            {},
            h("label", { for: "key-value" }, "API key or secret"),
            value,
            h("p", { id: "key-help", class: "small muted", style: "margin-top:4px" }, "The provider is recognised from the key where possible."),
          ),
          h(
            "div",
            { class: "row" },
            h("div", { class: "grow" }, h("label", { for: "key-provider" }, "Provider"), providerSelect),
            h("div", { class: "grow" }, h("label", { for: "key-name" }, "Name"), name),
          ),
          h("div", {}, h("label", { for: "key-label" }, "Label"), label),
          h("div", { class: "row" }, h("button", { class: "btn primary", type: "submit" }, "Seal into the vault")),
          formStatus,
        )
      : notice("This device may view secret names but not add keys.", "warn"),
    h(
      "div",
      { class: "card" },
      h("div", { class: "row" }, h("h2", { class: "grow", style: "margin:0" }, "Sealed secrets"), ctx.can("vault:write") ? rotate : null),
      listStatus,
      h("div", { style: "margin-top:12px" }, secretsList),
    ),
  );

  if (opts.prefillKey && ctx.can("vault:write")) {
    value.value = opts.prefillKey;
    onKeyInput();
    replace(formStatus, notice("Moved here from chat; it was not sent anywhere. Check the provider and seal it.", "info"));
    value.focus();
  }
  void refresh();
};
