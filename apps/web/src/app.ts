import { ApiError, apiFor, setUnauthorizedHandler } from "./api.ts";
import { errorMessage } from "./context.ts";
import { createIdentity, loadIdentity } from "./identity.ts";
import { syncThemeColor } from "./prefs.ts";
import { renderClockSkew, renderInsecure, renderPairFailed, renderRevoked, renderUnreachable, renderWelcome } from "./screens.ts";
import { renderShell } from "./shell.ts";
import type { WhoAmI } from "./types.ts";
import { toast } from "./ui/toast.ts";

/*
 * Boot: secure context → device key → (pairing | welcome | the app).
 * The pairing flow is a separate bundle (/pair.js, with the invite schema),
 * fetched only when a #pair= link is opened; daily use never loads it.
 */

const PAIR_MODULE = "/pair.js";
/** Signed requests are only accepted within a minute of the node's clock. */
const SKEW_MS = 50_000;

/** Once per page: theme colour, service worker and its "new version" message. */
function init(): void {
  syncThemeColor();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);
  if (!("serviceWorker" in navigator) || !isSecureContext) return;
  let offered = false;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    if (offered || (event.data as { type?: string } | null)?.type !== "galahad:updated") return;
    offered = true;
    toast("A new version of Galahad is ready", { action: { label: "Reload", run: () => location.reload() }, duration: 0 });
  });
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    /* offline shell is a convenience, not a requirement */
  });
}

/** A 401 means a revoked or unknown key, unless this device's clock is simply wrong. */
function renderRefused(root: HTMLElement, error: ApiError): void {
  const skew = error.serverTime === null ? 0 : Date.now() - error.serverTime;
  if (Math.abs(skew) > SKEW_MS) renderClockSkew(root, skew, () => location.reload());
  else renderRevoked(root);
}

async function boot(): Promise<void> {
  const root = document.getElementById("app")!;
  if (!isSecureContext || !crypto?.subtle) {
    renderInsecure(root);
    return;
  }

  let identity = await loadIdentity();
  const inviteText = location.hash.match(/[#&]pair=([A-Za-z0-9._-]+)/)?.[1];
  if (inviteText) {
    if (identity?.enrolled) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    } else {
      identity ??= await createIdentity();
      try {
        const { renderPairing } = (await import(PAIR_MODULE)) as typeof import("./pair.ts");
        renderPairing(root, identity, inviteText, () => void boot());
      } catch {
        // A cached app may point at a pairing bundle the node has since replaced.
        renderPairFailed(root, "Galahad was just updated. Reload this page to continue pairing.");
      }
      return;
    }
  }
  if (!identity?.enrolled) {
    // A pasted invite: the way an app on the Home Screen pairs (links open in the browser, not in it).
    renderWelcome(root, identity, (invite) => {
      history.replaceState(null, "", `${location.pathname}${location.search}#pair=${invite}`);
      void boot();
    });
    return;
  }

  const api = apiFor(identity);
  setUnauthorizedHandler(() => {});
  let whoami: WhoAmI;
  try {
    whoami = await api.get<WhoAmI>("/api/whoami");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) renderRefused(root, error);
    else renderUnreachable(root, errorMessage(error), () => void boot());
    return;
  }
  const shell = renderShell(root, { api, identity, whoami });

  // One refused request isn't proof of revocation: ask once more before leaving the app.
  let state: "ok" | "checking" | "refused" = "ok";
  setUnauthorizedHandler(() => {
    if (state !== "ok") return;
    state = "checking";
    api
      .get<WhoAmI>("/api/whoami")
      .then(() => {
        state = "ok";
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          state = "refused";
          shell.dispose();
          renderRefused(root, error);
        } else state = "ok";
      });
  });
}

init();
void boot();
