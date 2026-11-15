import type { ConnectorView } from "@galahad/core";
import { type Ctx, errorMessage } from "../context.ts";
import { busy, button, callout, copyText, field, secretInput } from "../ui/controls.ts";
import { h, replace } from "../ui/dom.ts";
import { toast } from "../ui/toast.ts";
import { vaultChanged } from "./vault.ts";

/*
 * A connector that signs in as you (Gmail, Outlook) has, in place of a key, the app you registered with Google or
 * Microsoft and your sign-in (brain oauth.ts). Its card says where it stands and does the next thing: seal the app,
 * sign in (Google's consent page in a page of its own, which comes back to this node; Microsoft's code to type at its
 * page), or sign out. Nothing of the app or the sign-in ever comes back to this page.
 */

/** How long a started sign-in is watched for: as long as the node waits for it. */
const WATCH_MS = 10 * 60_000;

/** Where Google sends you back: this app's own address, which is what you register as the app's redirect URI. */
export const callbackUrl = (origin: string): string => `${origin}/oauth/callback`;

export function signInBlock(ctx: Ctx, c: ConnectorView): HTMLElement | null {
  if (!c.installed || !c.oauth) return null;
  const google = c.oauth.provider === "google";
  const who = google ? "Google" : "Microsoft";
  const status = h("div");
  const may = { vault: ctx.can("vault:write"), sign: ctx.can("brain:write") };

  /** Asks the node until the card says signed in (or the wait ends), then shows it. */
  const watch = (until = Date.now() + WATCH_MS): void => {
    const tick = async (): Promise<void> => {
      if (Date.now() > until || !status.isConnected) return;
      try {
        const now = (await ctx.api.get<{ connectors: ConnectorView[] }>("/api/connectors")).connectors.find((x) => x.id === c.id);
        if (now?.key === "ready") {
          toast(`Signed in to ${c.label}`, { tone: "ok", description: now.oauth?.account ? `As ${now.oauth.account}.` : undefined });
          vaultChanged.update((n) => n + 1);
          return;
        }
      } catch {
        /* asked again in a moment */
      }
      setTimeout(() => void tick(), 3000);
    };
    void tick();
  };

  const signIn = button(`Sign in with ${who}`, { variant: "primary", icon: "key" });
  signIn.addEventListener("click", () =>
    void busy(signIn, async () => {
      try {
        const started = await ctx.api.post<{ flow: "code"; url: string } | { flow: "device"; code: string; url: string; expires: number }>("/api/oauth/start", {
          connector: c.id,
          ...(google ? { redirect: callbackUrl(location.origin) } : {}),
        });
        if (started.flow === "code") {
          // Google's own page, in a page of its own: it comes back to this node, which says when you're in.
          window.open(started.url, "_blank", "noopener,noreferrer");
          replace(status, callout("quiet", "Finish in the page that opened: choose your account and allow it. This card says when you're signed in."));
        } else {
          const code = h("span", { class: "mono", style: "font-size:1.4em;letter-spacing:0.08em" }, started.code);
          const copy = button("Copy the code", { size: "sm", variant: "ghost", icon: "copy", onClick: () => void copyText(started.code, "Code copied") });
          replace(
            status,
            h(
              "div",
              { class: "stack tight" },
              h("p", { class: "small" }, "Open ", h("a", { href: started.url, target: "_blank", rel: "noopener noreferrer" }, started.url.replace(/^https?:\/\//, "")), ", sign in, and type this code:"),
              h("div", { class: "row" }, code, copy),
              h("p", { class: "tiny subtle" }, "This card says when you're signed in."),
            ),
          );
        }
        watch();
      } catch (error) {
        replace(status, callout("danger", errorMessage(error)));
      }
    }),
  );

  const signOut = button("Sign out", { size: "sm", variant: "ghost", icon: "x" });
  signOut.addEventListener("click", () =>
    void busy(signOut, async () => {
      try {
        await ctx.api.post("/api/oauth/signout", { connector: c.id });
        toast(`Signed out of ${c.label}`, { description: "The app you registered stays: sign in again any time." });
        vaultChanged.update((n) => n + 1);
      } catch (error) {
        replace(status, callout("danger", errorMessage(error)));
      }
    }),
  );

  // The app you registered: its client id, and for Google its secret (read, then cleared at once).
  const client = h("input", { class: "input mono", type: "text", autocomplete: "off", autocorrect: "off", spellcheck: "false", autocapitalize: "off", placeholder: google ? "1234-abc.apps.googleusercontent.com" : "00000000-0000-0000-0000-000000000000" });
  const secret = google ? secretInput({ label: `${c.label}'s client secret`, placeholder: "Its client secret" }) : null;
  const seal = button("Seal the app", { variant: c.key === "missing" ? "primary" : "default", type: "submit", icon: "vault" });
  const appForm = h(
    "form",
    {
      class: "stack tight",
      autocomplete: "off",
      hidden: c.key !== "missing" && c.key !== "wrong-origin",
      onsubmit: (event: Event) => {
        event.preventDefault();
        const id = client.value.trim();
        const key = secret?.input.value.trim() ?? "";
        if (secret) secret.input.value = "";
        if (!id || (google && !key)) {
          (id ? secret!.input : client).focus();
          return;
        }
        void busy(seal, async () => {
          try {
            await ctx.api.post("/api/oauth/app", { connector: c.id, client: id, ...(key ? { secret: key } : {}) });
            toast(`${c.label}'s app sealed`, { tone: "ok", description: "Now sign in as yourself." });
            vaultChanged.update((n) => n + 1);
          } catch (error) {
            replace(status, callout("danger", `${errorMessage(error)}${google ? ". The secret was cleared for safety; paste it again." : ""}`));
          }
        });
      },
    },
    field("Client ID", client),
    secret ? field("Client secret", secret.wrap) : null,
    h("div", { class: "row" }, seal),
  );

  const lines: HTMLElement[] = [];
  if (c.key === "ready") {
    lines.push(h("p", { class: "small" }, `Signed in${c.oauth.account ? ` as ${c.oauth.account}` : ""}. Each call carries a short-lived token the node gets for it; your sign-in never leaves your nodes, and no model sees either.`));
  } else if (c.key === "signed-out") {
    lines.push(h("p", { class: "small" }, `Its app is sealed. Sign in as yourself with ${who}: your mail stays between you, ${who} and your nodes.`));
  } else {
    lines.push(
      h("p", { class: "small" }, `It signs in as you with an app you register with ${who} yourself, once, so no one else's app stands between you and your mail.`),
      google
        ? h("p", { class: "tiny subtle wrap-anywhere" }, "In Google Cloud, make an OAuth client of the Web application type, with this as its redirect URI: ", h("span", { class: "mono" }, callbackUrl(location.origin)))
        : h("p", { class: "tiny subtle" }, "In Microsoft Entra, register an app for personal and work accounts, and allow public client flows."),
    );
  }
  const actions = h(
    "div",
    { class: "row wrap" },
    c.key === "signed-out" && may.sign ? signIn : null,
    c.key === "ready" && may.sign ? signOut : null,
    c.key !== "missing" && c.key !== "wrong-origin" && may.vault
      ? button("Replace the app", {
          size: "sm",
          variant: "ghost",
          icon: "edit",
          onClick: (event) => {
            appForm.hidden = false;
            (event.currentTarget as HTMLElement).remove();
            client.focus();
          },
        })
      : null,
  );
  return h(
    "div",
    { class: "stack tight" },
    ...lines,
    actions,
    may.vault ? appForm : c.key === "missing" ? callout("quiet", "This device can't seal an app (no vault:write scope).") : null,
    status,
  );
}
