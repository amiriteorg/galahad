import type { CompanionView } from "@galahad/core";
import { cleanCompanionName, companionNameProblem } from "@galahad/core/companion";
import { isUnavailable } from "../api.ts";
import { type Ctx, errorMessage, type View } from "../context.ts";
import { forgetIdentity } from "../identity.ts";
import { shortId } from "../lib/text.ts";
import { chatEnter, type ChatEnterPref, type MotionPref, motionPref, setChatEnter, setMotion, setTheme, type ThemePref, themePref } from "../prefs.ts";
import { button, callout, copyText, pageHead, section, segmented } from "../ui/controls.ts";
import { confirmAction } from "../ui/dialog.ts";
import { h, replace, type Scope } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { SCOPE_INFO } from "./fleet.ts";

/* Appearance, his dog's name, this device's identity and permissions, what's kept here, and the way out. */

export const APP_VERSION = "0.1.0";

export async function forgetThisBrowser(): Promise<void> {
  const ok = await confirmAction({
    title: "Forget this browser?",
    body: [
      h("p", {}, "Its device key is deleted from this browser for good. You'll need a fresh invite to pair it again."),
      h("p", {}, "The fleet still lists it until you revoke it from another device's Fleet page."),
    ],
    confirmLabel: "Forget this browser",
  });
  if (!ok) return;
  await forgetIdentity();
  location.hash = "";
  location.reload();
}

/**
 * His dog's name: one field, saved when you leave it (or press Enter), on every device at once (it's the owner's
 * setting in the mind). What a name may be is said under the field, in the node's own words, before anything is sent.
 */
function dogSection(ctx: Ctx, scope: Scope): HTMLElement | null {
  if (!ctx.can("mind:read")) return null;
  const mayName = ctx.can("brain:write");
  const RESTING = mayName ? "Up to 24 letters, digits, spaces, hyphens or apostrophes. Clear it to take the name back." : "This device can't change it: it was paired without the brain:write scope.";
  const input = h("input", { class: "input", id: "dog-name", type: "text", autocomplete: "off", autocapitalize: "words", spellcheck: "false", enterkeyhint: "done", maxlength: 80, placeholder: "No name yet", disabled: true, "aria-describedby": "dog-name-note" });
  const note = h("div", { class: "hint", id: "dog-name-note", role: "status" }, RESTING);
  /** The name the node holds ("" while it has none). */
  let kept = "";
  let saving = false;

  const say = (text: string, wrong = false): void => {
    note.textContent = text;
    note.className = wrong ? "error" : "hint";
    if (wrong) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };

  async function save(): Promise<void> {
    const name = cleanCompanionName(input.value);
    if (saving) return;
    if (name === kept) {
      input.value = kept;
      say(RESTING);
      return;
    }
    const problem = name ? companionNameProblem(name) : null;
    if (problem) return say(problem, true);
    saving = true;
    say("Saving…");
    try {
      const view = await ctx.api.post<CompanionView>("/api/companion", { name: name || null }, scope.signal);
      kept = view.name ?? "";
      input.value = kept;
      say(kept ? `Saved. His dog is ${kept}, in the SANDBOX and in his journal, on every device.` : "Saved. It's the dog again, until you name it.");
    } catch (error) {
      if (!scope.disposed) say(errorMessage(error), true);
    } finally {
      saving = false;
    }
  }

  input.addEventListener("change", () => void save());
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") void save();
    else if (event.key === "Escape" && input.value !== kept) {
      event.stopPropagation();
      input.value = kept;
      say(RESTING);
    }
  });
  // Once a name is wrong, the message follows what you type until it's right.
  input.addEventListener("input", () => {
    if (note.className !== "error") return;
    const name = cleanCompanionName(input.value);
    const problem = name ? companionNameProblem(name) : null;
    if (problem) say(problem, true);
    else say(RESTING);
  });

  const el = section(
    "His dog",
    {},
    h(
      "div",
      { class: "card rows" },
      h(
        "div",
        { class: "item", style: "flex-wrap:wrap" },
        h(
          "div",
          { class: "grow", style: "min-width:200px" },
          h("label", { class: "strong small", for: "dog-name", style: "display:block" }, "Name"),
          h("div", { class: "tiny subtle" }, "What his dog answers to, in the SANDBOX and in his journal, on every device."),
        ),
        h("div", { class: "field dog-field" }, input, note),
      ),
    ),
  );

  void (async () => {
    try {
      const view = await ctx.api.get<CompanionView>("/api/companion", scope.signal);
      if (scope.disposed) return;
      kept = view.name ?? "";
      input.value = kept;
      input.disabled = !mayName;
    } catch (error) {
      if (scope.disposed) return;
      // A node from before his dog could be named: nothing to set here yet.
      if (isUnavailable(error)) el.hidden = true;
      else say(`Couldn't read his dog's name: ${errorMessage(error)}`, true);
    }
  })();
  return el;
}

export const settingsView: View = (root, ctx, { scope }) => {
  const theme = segmented<ThemePref>(
    [
      { value: "system", label: "System", icon: "monitor" },
      { value: "light", label: "Light", icon: "sun" },
      { value: "dark", label: "Dark", icon: "moon" },
    ],
    themePref(),
    setTheme,
    { label: "Theme" },
  );
  const motion = segmented<MotionPref>(
    [
      { value: "system", label: "System" },
      { value: "reduce", label: "Reduced" },
      { value: "full", label: "Full" },
    ],
    motionPref(),
    setMotion,
    { label: "Motion" },
  );

  // What Enter does when you send a message while he's working (the other is Ctrl or ⌘ with Enter, or its own button).
  const enter = segmented<ChatEnterPref>(
    [
      { value: "steer", label: "Steers him" },
      { value: "queue", label: "Queues it" },
    ],
    chatEnter(),
    setChatEnter,
    { label: "Enter while he works" },
  );

  const row = (label: string, hint: string, control: HTMLElement) =>
    h("div", { class: "item center", style: "flex-wrap:wrap" }, h("div", { class: "grow", style: "min-width:200px" }, h("div", { class: "strong small" }, label), h("div", { class: "tiny subtle" }, hint)), control);

  const known = SCOPE_INFO.filter((s) => s.scope !== "sandbox" || ctx.whoami.scopes.includes("sandbox"));
  replace(
    root,
    h(
      "div",
      { class: "page narrow" },
      pageHead("Settings", "How Galahad looks on this device, and what this device may do."),
      section(
        "Appearance",
        {},
        h(
          "div",
          { class: "card rows" },
          row("Theme", "Follows your system unless you choose.", theme.el),
          row("Motion", "Reduced keeps every change instant.", motion.el),
        ),
      ),
      ctx.can("chat")
        ? section(
            "Chat",
            {},
            h(
              "div",
              { class: "card rows" },
              row(
                "Enter while he works",
                "Steer: your message reaches him now, at his next safe point. Queue: it's kept on the node and sent when he's done. Ctrl or ⌘ with Enter does the other; on a phone each has its own button.",
                enter.el,
              ),
            ),
          )
        : null,
      dogSection(ctx, scope),
      section(
        "This device",
        {},
        h(
          "div",
          { class: "card pad stack loose" },
          h(
            "dl",
            { class: "kv" },
            h("dt", {}, "Name"),
            h("dd", {}, ctx.identity.name),
            h("dt", {}, "Device key"),
            h(
              "dd",
              { class: "row" },
              h("span", { class: "mono" }, shortId(ctx.identity.device, 16)),
              button("Copy device id", { size: "sm", variant: "ghost", iconOnly: true, icon: "copy", onClick: () => void copyText(ctx.identity.device, "Device id copied") }),
            ),
            h("dt", {}, "Talks to"),
            h("dd", {}, ctx.whoami.nodeName, h("span", { class: "subtle mono" }, ` · ${location.host}`)),
            h("dt", {}, "Fleet"),
            h("dd", {}, ctx.whoami.fleetName ?? "unnamed", h("span", { class: "subtle mono" }, ` · ${shortId(ctx.whoami.fleet, 10)}`)),
          ),
          h("div", { class: "stack tight" }, h("div", { class: "label" }, "What this device may do"), h(
            "div",
            { class: "scope-list" },
            ...known.map((s) => {
              const on = ctx.whoami.scopes.includes(s.scope);
              return h(
                "div",
                { class: `scope ${on ? "on" : "off"}` },
                icon(on ? "check-circle" : "minus", { size: 15, label: on ? "granted" : "not granted" }),
                h("div", {}, h("div", { class: "scope-name" }, s.scope), h("div", { class: "tiny subtle" }, s.label)),
              );
            }),
          )),
          h("p", { class: "tiny subtle" }, "Scopes are set when a device is paired. To change them, pair again with a new invite and revoke the old entry."),
        ),
      ),
      section(
        "Kept on this device",
        {},
        h(
          "div",
          { class: "card rows" },
          h("div", { class: "item" }, icon("key", { size: 16 }), h("div", { class: "grow small" }, h("div", { class: "strong" }, "A device key"), h("div", { class: "subtle tiny" }, "In IndexedDB, created non-extractable: it can sign, but nothing can read it out, not even this page."))),
          h("div", { class: "item" }, icon("settings", { size: 16 }), h("div", { class: "grow small" }, h("div", { class: "strong" }, "Display preferences"), h("div", { class: "subtle tiny" }, "Theme, motion, sidebar, last page, chat role, what Enter does while he works, which kept chat you had open (its id, never a word of it), and the SANDBOX's choices (its map, his eyes, the sky you preview, and when you last looked in, so he knows to greet you), in localStorage. Nothing else."))),
          h("div", { class: "item" }, icon("chat", { size: 16 }), h("div", { class: "grow small" }, h("div", { class: "strong" }, "Chats: not on this device"), h("div", { class: "subtle tiny" }, "Kept privately on the node you talk to, with what you queued behind them, and deleted there when you delete them; temporary chats aren't kept at all. Keys you paste are never kept."))),
        ),
      ),
      section(
        "Leave",
        {},
        h(
          "div",
          { class: "card danger pad stack" },
          h("div", { class: "row wrap" }, h("div", { class: "grow" }, h("div", { class: "strong small" }, "Forget this browser"), h("div", { class: "tiny subtle" }, "Deletes this browser's device key. Revoke it on the Fleet page too, from any device.")), button("Forget this browser…", { variant: "danger", icon: "logout", onClick: () => void forgetThisBrowser() })),
        ),
      ),
      section(
        "About",
        {},
        h(
          "div",
          { class: "card pad row" },
          h("img", { src: "/icon.svg", alt: "", width: 40, height: 40, style: "border-radius:10px" }),
          h("div", { class: "grow" }, h("div", { class: "strong" }, "Galahad"), h("div", { class: "tiny subtle" }, `App ${APP_VERSION} · served by ${ctx.whoami.nodeName} · one mind, many bodies`)),
          button("Shortcuts", { size: "sm", variant: "ghost", icon: "command", onClick: () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "?" })) }),
        ),
      ),
      ctx.whoami.scopes.length ? null : callout("warn", "This device has no scopes. Pair it again with a new invite."),
    ),
  );
};
