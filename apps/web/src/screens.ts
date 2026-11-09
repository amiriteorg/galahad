import { greeting } from "./lib/time.ts";
import { shortId } from "./lib/text.ts";
import { button, callout, copyField } from "./ui/controls.ts";
import { confirmAction } from "./ui/dialog.ts";
import { type Child, h, replace } from "./ui/dom.ts";
import { icon } from "./ui/icons.ts";
import { type BrowserIdentity, forgetIdentity } from "./identity.ts";

/*
 * Full-screen states outside the app shell: welcome (unpaired), revoked,
 * insecure context, unreachable node. Calm, centred, one clear next step.
 */

export function solo(...children: Child[]): HTMLElement {
  return h("div", { class: "solo" }, h("main", { class: "solo-card" }, ...children));
}

export function hero(title: string, lede: Child): HTMLElement {
  return h("header", { class: "hero" }, h("img", { src: "/icon.svg", alt: "", width: 56, height: 56 }), h("h1", {}, title), h("p", {}, lede));
}

export function trustStrip(): HTMLElement {
  return h(
    "div",
    { class: "trust-strip" },
    h("span", {}, icon("key"), "Key never leaves this browser"),
    h("span", {}, icon("shield-check"), "You approve every device"),
    h("span", {}, icon("vault"), "Secrets stay in the vault"),
  );
}

const footer = () => h("footer", { class: "solo-foot" }, h("span", {}, "Galahad · one mind, many bodies"));

export function renderWelcome(root: HTMLElement, identity: BrowserIdentity | null): void {
  document.title = "Welcome · Galahad";
  replace(
    root,
    solo(
      hero(`${greeting()}.`, "This browser isn't part of your fleet yet. Pairing takes a minute and needs one of your nodes."),
      h(
        "section",
        { class: "card", "aria-label": "How to pair" },
        h(
          "ol",
          { class: "steps-num" },
          h("li", {}, h("div", {}, h("span", { class: "strong", style: "color:var(--text)" }, "On any of your nodes, run"), copyField("galahad invite --client"))),
          h("li", {}, h("div", {}, h("span", {}, "Open the link it prints ", h("strong", {}, "on this device"), ". It works once and expires in ten minutes."))),
          h("li", {}, h("div", {}, h("span", {}, "Both screens show a six-digit code. Approve on the node ", h("strong", {}, "only if the codes match"), "."))),
        ),
        identity ? h("p", { class: "tiny subtle", style: "text-align:center" }, "This browser's key ", h("span", { class: "mono" }, shortId(identity.device, 12))) : null,
      ),
      trustStrip(),
      footer(),
    ),
  );
}

export function renderRevoked(root: HTMLElement): void {
  document.title = "Not recognised · Galahad";
  const forget = button("Forget this browser's key", {
    variant: "primary",
    onClick: async () => {
      const ok = await confirmAction({
        title: "Forget this browser's key?",
        body: "The key is deleted from this browser and can't be recovered. You can pair again with a fresh invite.",
        confirmLabel: "Forget key",
      });
      if (!ok) return;
      await forgetIdentity();
      location.reload();
    },
  });
  replace(
    root,
    solo(
      hero("This browser is no longer recognised.", "Its key may have been revoked, or this node doesn't know it."),
      h(
        "section",
        { class: "card" },
        h("p", { class: "small muted" }, "To pair again, forget this browser's key, then open a fresh invite from ", h("span", { class: "mono" }, "galahad invite --client"), "."),
        h("p", { class: "tiny subtle" }, "If this browser was approved on another node only moments ago, the news may still be on its way here: try again first."),
        h("div", { class: "row wrap", style: "justify-content:center" }, forget, button("Try again", { icon: "retry", onClick: () => location.reload() })),
      ),
      footer(),
    ),
  );
}

export function renderInsecure(root: HTMLElement): void {
  document.title = "Secure connection needed · Galahad";
  replace(
    root,
    solo(
      hero("A secure connection is needed.", "Device keys only work over HTTPS (or on localhost)."),
      h("section", { class: "card" }, h("p", { class: "small muted" }, "On the node, run this and open the HTTPS address it prints:"), copyField("galahad expose")),
      footer(),
    ),
  );
}

export function renderUnreachable(root: HTMLElement, message: string, retry: () => void): void {
  document.title = "Unreachable · Galahad";
  const offline = !navigator.onLine;
  replace(
    root,
    solo(
      hero(
        offline ? "You're offline." : "Galahad can't be reached just now.",
        offline ? "The app is cached on this device; your fleet's live data returns when you reconnect." : "The node may be restarting, or your tailnet may be down.",
      ),
      h(
        "section",
        { class: "card" },
        callout("quiet", message, { icon: offline ? "offline" : "alert" }),
        h("div", { class: "row", style: "justify-content:center" }, button("Try again", { variant: "primary", icon: "retry", onClick: retry })),
      ),
      footer(),
    ),
  );
}

export function renderClockSkew(root: HTMLElement, skewMs: number, retry: () => void): void {
  document.title = "Check the clock · Galahad";
  const minutes = Math.max(1, Math.round(Math.abs(skewMs) / 60_000));
  replace(
    root,
    solo(
      hero("This device's clock is off.", `It's about ${minutes} minute${minutes === 1 ? "" : "s"} ${skewMs > 0 ? "ahead of" : "behind"} your node.`),
      h(
        "section",
        { class: "card" },
        h("p", { class: "small muted" }, "Every request is signed with the time, and your node only accepts signatures within a minute of its own clock. Set this device's clock to update automatically, then try again. Your key is fine."),
        h("div", { class: "row", style: "justify-content:center" }, button("Try again", { variant: "primary", icon: "retry", onClick: retry })),
      ),
      footer(),
    ),
  );
}

export function renderPairFailed(root: HTMLElement, message: string): void {
  replace(root, solo(hero("That invite didn't work.", message), footer()));
}
