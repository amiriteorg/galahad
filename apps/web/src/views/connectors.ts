import type { ConnectorToolView, ConnectorView } from "@galahad/core";
import { findSecrets } from "@galahad/core/secret-scan";
import { type Ctx, errorMessage, type View } from "../context.ts";
import { plural } from "../lib/text.ts";
import { duration } from "../lib/time.ts";
import { badge, busy, button, callout, empty, errorState, field, pageHead, secretInput, section, skeletonBlock, type Tone } from "../ui/controls.ts";
import { confirmAction, openSheet } from "../ui/dialog.ts";
import { h, keepPlace, replace } from "../ui/dom.ts";
import { icon, type IconName } from "../ui/icons.ts";
import { signal } from "../ui/signal.ts";
import { toast } from "../ui/toast.ts";
import { CLASS_INFO } from "./activity.ts";
import { vaultChanged } from "./vault.ts";

/*
 * Connectors: how Galahad reaches the services you use. Each is a manifest,
 * data rather than code: one pinned origin, the vault secret it signs in with,
 * and tools that are one HTTP request each with an oath class. Reading,
 * creating and changing are his to do (and logged); outward tools and deletes
 * ask you first. A connector's key goes from a password field into the vault,
 * pinned to the connector's origin; no model, arm or loop ever sees it.
 */

/** Bumped whenever a connector is installed or removed, or its key changes. */
export const connectorsChanged = signal(0);

export const KEY_STATE: Record<string, { label: string; tone: Tone; icon: IconName; explain: string }> = {
  "none-needed": { label: "no key needed", tone: "neutral", icon: "check", explain: "It works without a key." },
  ready: { label: "key sealed", tone: "ok", icon: "check", explain: "Its key is sealed in the vault and only ever sent to this origin." },
  missing: { label: "needs a key", tone: "warn", icon: "key", explain: "It can't do anything until its key is in the vault." },
  "optional-missing": { label: "public only", tone: "neutral", icon: "key", explain: "Public reads work without a key, at a lower rate limit. Add one to reach your own data." },
  "wrong-origin": {
    label: "key pinned elsewhere",
    tone: "danger",
    icon: "alert",
    explain: "The vault holds a key under this name, but it's pinned to another origin, so it's never sent here. Replace it with one entered for this connector.",
  },
};

const host = (origin: string | null): string => origin?.replace(/^https?:\/\//, "") ?? "";

export async function loadConnectors(ctx: Ctx, abort?: AbortSignal): Promise<ConnectorView[]> {
  return (await ctx.api.get<{ connectors: ConnectorView[] }>("/api/connectors", abort)).connectors;
}

export type ArgValue = string | number | boolean;
export type ArgsRead = { args: Record<string, ArgValue> } | { problem: string; focus: HTMLElement };

const LONG_TEXT = /^(body|text|message|content|description)$/;

/**
 * Form fields for a tool's parameters, typed from its declaration: a choice for
 * enums and booleans, a number field for numbers, text otherwise. Arguments leave
 * this machine and approvals replicate in plaintext, so a key typed here is refused.
 */
export function argFields(tool: ConnectorToolView, initial: Record<string, unknown> = {}): { el: HTMLElement; read(): ArgsRead } {
  const readers: (() => ArgsRead | { name: string; value: ArgValue | undefined })[] = [];
  const fields: HTMLElement[] = [];
  for (const [name, p] of Object.entries(tool.params)) {
    const start = initial[name];
    const label = p.required ? name : `${name} (optional)`;
    const hint = p.description ?? undefined;
    if (p.enum || p.type === "boolean") {
      const options: [string, string][] = p.type === "boolean" ? [["true", "yes"], ["false", "no"]] : p.enum!.map((v) => [v, v]);
      const select = h(
        "select",
        { class: "select" },
        h("option", { value: "" }, p.required ? "Choose…" : "Not set"),
        ...options.map(([value, text]) => h("option", { value, selected: start !== undefined && String(start) === value }, text)),
      );
      fields.push(field(label, select, { hint }));
      readers.push(() => {
        if (!select.value) return p.required ? { problem: `Choose ${name}.`, focus: select } : { name, value: undefined };
        return { name, value: p.type === "boolean" ? select.value === "true" : select.value };
      });
      continue;
    }
    const numeric = p.type === "integer" || p.type === "number";
    const control = !numeric && LONG_TEXT.test(name)
      ? h("textarea", { class: "textarea", rows: 4, spellcheck: "true" })
      : h("input", {
          class: numeric ? "input tnum" : "input",
          type: numeric ? "number" : "text",
          inputmode: p.type === "integer" ? "numeric" : numeric ? "decimal" : null,
          step: p.type === "integer" ? 1 : numeric ? "any" : null,
          autocomplete: "off",
          spellcheck: "false",
          autocapitalize: "off",
        });
    if (start !== undefined && start !== null) control.value = String(start);
    fields.push(field(label, control, { hint }));
    readers.push(() => {
      const raw = control.value.trim();
      if (!raw) return p.required ? { problem: `${name} is required.`, focus: control } : { name, value: undefined };
      if (numeric) {
        const n = Number(raw);
        if (!Number.isFinite(n) || (p.type === "integer" && !Number.isInteger(n))) return { problem: `${name} must be ${p.type === "integer" ? "a whole number" : "a number"}.`, focus: control };
        return { name, value: n };
      }
      if (findSecrets(raw).length) {
        control.value = "";
        return { problem: `${name} looks like it holds a key, so it was cleared. Connectors take keys from the vault, never from their arguments.`, focus: control };
      }
      return { name, value: raw };
    });
  }
  return {
    el: fields.length ? h("div", { class: "stack" }, ...fields) : h("p", { class: "small subtle" }, "This tool takes nothing."),
    read() {
      const args: Record<string, ArgValue> = {};
      for (const reader of readers) {
        const result = reader();
        if ("problem" in result) return result;
        if ("name" in result && result.value !== undefined) args[result.name] = result.value;
      }
      return { args };
    },
  };
}

/** What a tool's class means for you, in a sentence. */
export function classNote(cls: string, who: "you" | "loop"): HTMLElement | null {
  if (cls === "outward") {
    return who === "you"
      ? callout("warn", "It's outward: others may see it, or it acts in the world. You're the one asking, so it goes as soon as you confirm.", { title: "Sent when you confirm" })
      : callout("warn", "It's outward, so each run files a request in your Inbox instead of sending. Nothing goes until you approve it.", { title: "Each run asks you" });
  }
  if (cls === "delete") {
    return who === "you"
      ? callout("danger", "It deletes something, and that can't be undone. You're the one asking, so it goes as soon as you confirm.", { title: "Deletes for good" })
      : callout("warn", "It deletes, so each run files a request in your Inbox instead. Nothing is deleted until you approve it.", { title: "Each run asks you" });
  }
  if (cls === "create" || cls === "modify") return callout("quiet", "It creates or changes something. That's Galahad's to do, and the ledger records it.");
  return null;
}

/** The value a delete names (a bucket, say), for typed confirmation; else the tool's name. */
function deleteName(tool: ConnectorToolView, args: Record<string, ArgValue>): string {
  const last = Object.entries(tool.params).filter(([, p]) => p.required && p.type === "string").map(([name]) => name).at(-1);
  const value = last ? args[last] : undefined;
  return typeof value === "string" && value ? value : tool.name;
}

type CallOutcome =
  | { status: "done"; class: string; target: string; result: { ok: boolean; status: number; body: string; truncated: boolean; durationMs: number } }
  | { status: "asked"; action: string; class: string; target: string; expires: number };

function outcomeView(outcome: CallOutcome): HTMLElement {
  if (outcome.status === "asked") return callout("info", `Filed for approval: it waits in your Inbox as ${outcome.action}.`);
  const r = outcome.result;
  let body = r.body;
  try {
    body = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    /* not JSON: shown as it came */
  }
  return h(
    "div",
    { class: "stack tight", "aria-live": "polite" },
    h(
      "div",
      { class: "row wrap tiny subtle" },
      badge(String(r.status), r.ok ? "ok" : "danger"),
      h("span", { class: "mono wrap-anywhere" }, outcome.target),
      h("span", { class: "tnum" }, duration(r.durationMs)),
      r.truncated ? h("span", {}, "clipped") : null,
    ),
    body ? h("pre", { class: "result" }, body) : h("p", { class: "small subtle" }, "No body."),
  );
}

/** Run one tool now, as you. Outward tools and deletes confirm first: your asking is the approval. */
export function openRunTool(ctx: Ctx, c: ConnectorView, tool: ConnectorToolView): void {
  const info = CLASS_INFO[tool.class];
  const args = argFields(tool);
  const status = h("div");
  const out = h("div");
  const run = button(tool.asks ? "Send" : "Run", { variant: "primary", type: "submit", icon: tool.asks ? "external" : "play" });
  const form = h(
    "form",
    {
      class: "stack loose",
      autocomplete: "off",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        replace(status);
        const read = args.read();
        if ("problem" in read) {
          replace(status, callout("warn", read.problem));
          read.focus.focus();
          return;
        }
        if (tool.asks) {
          const ok = await confirmAction({
            title: tool.class === "delete" ? `Delete with ${c.label}?` : `Send with ${c.label}?`,
            body: [
              h("p", {}, h("span", { class: "mono strong" }, `${c.id}.${tool.name}`), ` goes to ${host(c.origin)} once, now.`),
              h("p", {}, tool.class === "delete" ? "What it deletes can't be brought back." : "Others may see it, and it can't be called back."),
            ],
            confirmLabel: tool.class === "delete" ? "Delete it" : "Send it",
            tone: tool.class === "delete" ? "danger" : "primary",
            typeToConfirm: tool.class === "delete" ? deleteName(tool, read.args) : undefined,
          });
          if (!ok) return;
        }
        await busy(run, async () => {
          try {
            const outcome = await ctx.api.post<CallOutcome>("/api/connectors/call", { connector: c.id, tool: tool.name, args: read.args });
            if (!sheet.scope.disposed) replace(out, outcomeView(outcome));
          } catch (error) {
            replace(status, callout("danger", errorMessage(error), { title: "It didn't run" }));
          }
        });
      },
    },
    h("div", { class: "row wrap" }, badge(info?.label.toLowerCase() ?? tool.class, info?.tone ?? "neutral", info?.icon), h("span", { class: "mono small subtle" }, `${tool.method} · ${host(c.origin)}`)),
    classNote(tool.class, "you"),
    args.el,
    status,
    h("div", { class: "row", style: "justify-content:flex-end" }, button("Close", { onClick: () => sheet.close() }), run),
    out,
  );
  const sheet = openSheet({ title: `${c.label} · ${tool.name}`, description: tool.description, body: form, size: "wide" });
}

function toolRow(ctx: Ctx, c: ConnectorView, tool: ConnectorToolView): HTMLElement {
  const info = CLASS_INFO[tool.class];
  const params = Object.entries(tool.params).map(([name, p]) => (p.required ? name : `[${name}]`)).join(" ");
  return h(
    "div",
    { class: "item" },
    h("span", { class: "avatar", "data-tone": info?.tone ?? "neutral", title: info?.label ?? tool.class }, icon(info?.icon ?? "eye", { size: 14 })),
    h(
      "div",
      { class: "grow" },
      h("div", { class: "row wrap" }, h("span", { class: "mono strong small" }, tool.name), badge(tool.class, info?.tone ?? "neutral"), tool.asks ? badge("asks you", "warn", "shield") : null),
      h("div", { class: "small muted" }, tool.description),
      params ? h("div", { class: "meta mono" }, params) : null,
    ),
    c.installed && ctx.can("connect")
      ? h("div", { class: "item-actions" }, button(`Run ${tool.name}`, { size: "sm", variant: "ghost", icon: "play", label: `Run ${c.id}.${tool.name}`, onClick: () => openRunTool(ctx, c, tool) }))
      : null,
  );
}

function keyBlock(ctx: Ctx, c: ConnectorView): HTMLElement | null {
  if (!c.installed || !c.secret || c.key === "none-needed") return null;
  const state = KEY_STATE[c.key];
  const secret = secretInput({ label: `Key for ${c.label}` });
  const seal = button("Seal", { variant: c.key === "ready" ? "default" : "primary", type: "submit", icon: "vault" });
  const status = h("div");
  const form = h(
    "form",
    {
      class: "row",
      autocomplete: "off",
      hidden: c.key === "ready",
      onsubmit: (event: Event) => {
        event.preventDefault();
        // Read, then clear at once: the key lives in this page as briefly as possible.
        const value = secret.input.value.trim();
        secret.input.value = "";
        if (!value) {
          secret.input.focus();
          return;
        }
        void busy(seal, async () => {
          try {
            await ctx.api.post("/api/secrets", { name: c.secret, value, connector: c.id });
            vaultChanged.update((n) => n + 1);
            toast(`${c.label}'s key sealed`, { tone: "ok", description: `Only ever sent to ${host(c.origin)}. No model ever sees it.` });
          } catch (error) {
            replace(status, callout("danger", `${errorMessage(error)}. The field was cleared for safety; paste the key again.`));
            secret.input.focus();
          }
        });
      },
    },
    h("div", { class: "grow" }, secret.wrap),
    seal,
  );
  const write = ctx.can("vault:write");
  return h(
    "div",
    { class: "stack tight" },
    h("p", { class: "small" }, state?.explain ?? `Key: ${c.key}`),
    c.keyHelp && c.key !== "ready" ? h("p", { class: "tiny subtle wrap-anywhere" }, `Where to get one: ${c.keyHelp}.`) : null,
    h(
      "div",
      { class: "row wrap tiny subtle" },
      h("span", {}, "Vault secret ", h("span", { class: "mono" }, c.secret)),
      write && c.key === "ready"
        ? button("Replace key", {
            size: "sm",
            variant: "ghost",
            icon: "edit",
            onClick: (event) => {
              form.hidden = false;
              (event.currentTarget as HTMLElement).remove();
              secret.input.focus();
            },
          })
        : null,
    ),
    write ? form : c.key === "ready" ? null : callout("quiet", "This device can't add keys (no vault:write scope)."),
    status,
  );
}

function installBlock(ctx: Ctx, c: ConnectorView): HTMLElement | null {
  if (c.installed || !ctx.can("brain:write")) return null;
  const status = h("div");
  const origin = c.needsOrigin
    ? h("input", { class: "input mono", type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", autocapitalize: "off", placeholder: "http://homeassistant.local:8123" })
    : null;
  const install = button("Install", { variant: "primary", size: "sm", type: "submit", icon: "plus" });
  return h(
    "form",
    {
      class: "stack tight",
      autocomplete: "off",
      onsubmit: (event: Event) => {
        event.preventDefault();
        replace(status);
        let address: string | undefined;
        if (origin) {
          try {
            const url = new URL(origin.value.trim());
            if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not http");
            address = url.origin;
          } catch {
            replace(status, callout("warn", "Give its address, such as http://homeassistant.local:8123."));
            origin.focus();
            return;
          }
        }
        void busy(install, async () => {
          try {
            const { connector } = await ctx.api.post<{ connector: ConnectorView }>("/api/connectors", { id: c.id, ...(address ? { origin: address } : {}) });
            connectorsChanged.update((n) => n + 1);
            toast(`${connector.label} installed`, {
              tone: "ok",
              description: connector.key === "missing" || connector.key === "wrong-origin" ? "Add its key next. Until then it can't do anything." : `${plural(connector.tools.length, "tool")}, on every node.`,
            });
          } catch (error) {
            replace(status, callout("danger", errorMessage(error), { title: "Couldn't install it" }));
          }
        });
      },
    },
    origin ? field("Its address", origin, { hint: "Where it runs on your network. Plain http only for this machine and private networks." }) : null,
    status,
    h("div", { class: "row" }, install),
  );
}

async function remove(ctx: Ctx, c: ConnectorView): Promise<void> {
  const ok = await confirmAction({
    title: `Remove ${c.label}?`,
    body: [h("p", {}, "Galahad can't reach it any more, and loops that call it fail until you install it again."), c.secret ? h("p", {}, "Its key stays in the vault until you delete it there.") : null],
    confirmLabel: "Remove connector",
  });
  if (!ok) return;
  try {
    await ctx.api.post("/api/connectors/remove", { id: c.id });
    connectorsChanged.update((n) => n + 1);
    toast(`${c.label} removed`, { tone: "ok" });
  } catch (error) {
    toast("Couldn't remove it", { tone: "error", description: errorMessage(error) });
  }
}

function connectorCard(ctx: Ctx, c: ConnectorView): HTMLElement {
  const state = KEY_STATE[c.key];
  const asking = c.tools.filter((t) => t.asks).length;
  return h(
    "article",
    { class: "card", "aria-label": c.label },
    h(
      "div",
      { class: "card-body stack" },
      h(
        "div",
        { class: "row top" },
        h("span", { class: "avatar" }, icon("plug", { size: 16 })),
        h(
          "div",
          { class: "grow" },
          h(
            "div",
            { class: "row wrap" },
            h("span", { class: "strong" }, c.label),
            c.installed ? (state ? badge(state.label, state.tone, state.icon) : badge(c.key)) : badge("not installed", "neutral"),
          ),
          h(
            "div",
            { class: "tiny subtle row wrap", style: "margin-top:2px" },
            h("span", { class: "mono" }, c.id),
            c.origin ? h("span", { class: "mono", title: "Every request goes to this origin and nowhere else" }, `only to ${host(c.origin)}`) : h("span", {}, c.needsOrigin ? "runs at an address of yours" : ""),
          ),
        ),
        c.installed && ctx.can("brain:write") ? button(`Remove ${c.label}`, { size: "sm", variant: "ghost", iconOnly: true, icon: "trash", onClick: () => void remove(ctx, c) }) : null,
      ),
      c.description ? h("p", { class: "small muted" }, c.description) : null,
      c.problem ? callout("warn", c.problem) : null,
      keyBlock(ctx, c),
      installBlock(ctx, c),
      c.tools.length
        ? h(
            "details",
            { class: "process" },
            h(
              "summary",
              { "data-key": `tools:${c.id}` },
              icon("chevron-right", { size: 14, class: "chev" }),
              `${plural(c.tools.length, "tool")}${asking ? ` · ${asking} ask${asking === 1 ? "s" : ""} you first` : ""}`,
            ),
            h("div", { class: "card flat", style: "margin-top:8px" }, h("div", { class: "rows" }, ...c.tools.map((t) => toolRow(ctx, c, t)))),
          )
        : null,
    ),
  );
}

export const connectorsView: View = (root, ctx, { scope }) => {
  const installedBox = h("div", { class: "grid wide" }, skeletonBlock(160));
  const availableBox = h("div", { class: "grid wide" });
  const note = h("div");
  const installedSection = section("Installed", {}, installedBox);
  const availableSection = section("Available", {}, availableBox);

  function render(list: ConnectorView[]): void {
    const installed = list.filter((c) => c.installed);
    const available = list.filter((c) => !c.installed);
    replace(
      note,
      installed.length && !ctx.can("connect")
        ? callout("quiet", "This device can't run tools itself (it has no connect scope; it was likely paired before connectors existed). Galahad and your loops still can.")
        : null,
    );
    replace(
      installedBox,
      ...(installed.length
        ? installed.map((c) => connectorCard(ctx, c))
        : [
            h(
              "div",
              { class: "card" },
              empty({ icon: "plug", title: "Nothing installed yet", body: "Install one below and add its key. Every node can use it; no model ever sees the key.", compact: true }),
            ),
          ]),
    );
    replace(availableBox, ...available.map((c) => connectorCard(ctx, c)));
    availableSection.hidden = !available.length;
  }

  async function refresh(): Promise<void> {
    try {
      const list = await loadConnectors(ctx, scope.signal);
      if (!scope.disposed) keepPlace(root, () => render(list));
    } catch (error) {
      if (!scope.disposed) replace(installedBox, errorState("Couldn't load connectors", error, () => void refresh()));
    }
  }

  replace(
    root,
    h(
      "div",
      { class: "page" },
      pageHead("Connectors", "How Galahad reaches the services you use. Reading, creating and changing are his to do, and logged. Anything outward, and every delete, asks you first."),
      ctx.can("brain:write") ? null : callout("quiet", "This device can see connectors but not install or remove them (no brain:write scope)."),
      note,
      installedSection,
      availableSection,
      h("p", { class: "tiny subtle" }, "A service of your own: describe it in a manifest and run ", h("span", { class: "mono" }, "galahad connector add --manifest file.json"), " on a node."),
    ),
  );

  scope.add(connectorsChanged.subscribe(() => void refresh()));
  scope.add(vaultChanged.subscribe(() => void refresh()));
  void refresh();
};
