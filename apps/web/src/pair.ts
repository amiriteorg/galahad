import { approvalProof, decodeInvite, fromB64u, type Invite, pairProof, type PairRequestFields, proofMatches, sasCode, statusProof } from "@galahad/core";
import { ApiError, pairPost } from "./api.ts";
import { errorMessage } from "./context.ts";
import { h, notice, replace, short } from "./dom.ts";
import { type BrowserIdentity, forgetIdentity, saveIdentity } from "./identity.ts";

/*
 * Pairing this browser:
 *  1. prove we hold the invite (HMAC over our public key; the secret never leaves the page)
 *  2. show the 6-digit code derived from (invite secret, fleet, our key)
 *  3. you approve on a node only if it shows the same code
 *  4. we verify the approval is authentic before trusting it
 * Requests go to this page's own origin, never to the invite's tailnet address.
 */

const clearHash = () => history.replaceState(null, "", `${location.pathname}${location.search}`);

function hero(title: string, lede: string): HTMLElement {
  return h("div", { class: "hero" }, h("img", { src: "/icon.svg", alt: "" }), h("h1", {}, title), h("p", { class: "muted" }, lede));
}

export function renderWelcome(root: HTMLElement, identity: BrowserIdentity | null): void {
  replace(
    root,
    h(
      "div",
      { class: "center" },
      h(
        "div",
        { class: "card" },
        hero("Good day.", "This browser is not yet part of your fleet."),
        h("p", {}, "To pair it, run this on any of your Galahad nodes:"),
        h("div", { class: "copybox" }, h("code", {}, "galahad invite --client")),
        h("p", { class: "small muted", style: "margin-top:10px" }, "Then open the link it prints on this device. You will be shown a code to compare on both screens."),
        identity ? h("p", { class: "small muted" }, `This browser's key: ${short(identity.device, 12)}`) : null,
      ),
    ),
  );
}

export function renderRevoked(root: HTMLElement): void {
  replace(
    root,
    h(
      "div",
      { class: "center" },
      h(
        "div",
        { class: "card stack" },
        hero("This browser is no longer recognised.", "Its key may have been revoked, or the node no longer knows it."),
        h("p", {}, "To pair again, forget this browser's key, then open a fresh invite link from `galahad invite --client`."),
        h(
          "div",
          { class: "row", style: "justify-content:center" },
          h(
            "button",
            {
              class: "btn primary",
              type: "button",
              onclick: async () => {
                await forgetIdentity();
                location.reload();
              },
            },
            "Forget this browser's key",
          ),
          h("button", { class: "btn", type: "button", onclick: () => location.reload() }, "Try again"),
        ),
      ),
    ),
  );
}

export function renderInsecure(root: HTMLElement): void {
  replace(
    root,
    h(
      "div",
      { class: "center" },
      h(
        "div",
        { class: "card" },
        hero("A secure connection is needed.", "Device keys only work over HTTPS (or on localhost)."),
        h("p", {}, "On the node, run this and open the HTTPS address it prints:"),
        h("div", { class: "copybox" }, h("code", {}, "galahad expose")),
      ),
    ),
  );
}

export function renderPairing(root: HTMLElement, identity: BrowserIdentity, inviteText: string, onPaired: () => void): void {
  let invite: Invite;
  try {
    invite = decodeInvite(inviteText);
    if (invite.k !== "client") throw new Error("This invite is for a machine. Run `galahad join …` on that machine instead.");
  } catch (error) {
    clearHash();
    replace(root, h("div", { class: "center" }, h("div", { class: "card" }, hero("That invite didn't work.", errorMessage(error)))));
    return;
  }
  const secret = fromB64u(invite.s);
  const nameInput = h("input", { type: "text", id: "device-name", value: identity.name, maxlength: 64, autocomplete: "off" });
  const status = h("div", { "aria-live": "polite" });
  const join = h("button", { class: "btn primary", type: "submit" }, "Ask to join");
  let polling = false;

  async function request(event: Event): Promise<void> {
    event.preventDefault();
    const name = nameInput.value.trim().slice(0, 64) || identity.name;
    const fields: PairRequestFields = { invite: invite.i, device: identity.device, name, kind: "client" };
    join.disabled = true;
    try {
      const response = await pairPost<{ status: string; sas: string }>("/link/pair/request", {
        ...fields,
        proof: pairProof(secret, fields),
      });
      const expected = sasCode(secret, invite.f, identity.device);
      if (response.sas !== expected) throw new Error("The node computed a different code. Stopping here, to be safe.");
      identity.name = name;
      replace(
        status,
        h("p", {}, "Your code:"),
        h("div", { class: "sas", "aria-label": `Code ${expected.split("").join(" ")}` }, expected),
        h("p", { class: "muted" }, "Approve on your node (the PWA's Fleet page, or the terminal running `galahad invite`) only if it shows this exact code. Waiting…"),
      );
      nameInput.disabled = true;
      void poll();
    } catch (error) {
      join.disabled = false;
      const message = error instanceof ApiError && error.status === 409 && /already enrolled/.test(error.message)
        ? "This browser's key is already enrolled. If it was revoked, forget the key and use a fresh invite."
        : errorMessage(error);
      replace(status, notice(message, "error"));
    }
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    const proof = statusProof(secret, invite.i, identity.device);
    try {
      for (;;) {
        const result = await pairPost<{ status: string; fleet?: string; approval?: string }>("/link/pair/status", {
          invite: invite.i,
          device: identity.device,
          proof,
        });
        if (result.status === "rejected") throw new Error("The pairing was declined on the node.");
        if (result.status === "approved") {
          const expected = approvalProof(secret, invite.i, identity.device, invite.f);
          if (result.fleet !== invite.f || !result.approval || !proofMatches(expected, result.approval)) {
            throw new Error("The approval could not be verified. Stopping here, to be safe.");
          }
          identity.enrolled = true;
          await saveIdentity(identity);
          clearHash();
          onPaired();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (error) {
      replace(status, notice(errorMessage(error), "error"));
    } finally {
      polling = false;
    }
  }

  replace(
    root,
    h(
      "div",
      { class: "center" },
      h(
        "form",
        { class: "card stack", onsubmit: (event: Event) => void request(event) },
        hero("Join the fleet", "This browser will get its own key. It can never be read out, even by this page."),
        h("div", {}, h("label", { for: "device-name" }, "Name this device"), nameInput),
        h("div", { class: "row", style: "justify-content:center" }, join),
        status,
      ),
    ),
  );
}
