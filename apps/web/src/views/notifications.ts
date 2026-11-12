import { NOTIFY_KIND_INFO, NOTIFY_KINDS, NOTIFY_PER_DAY, type NotifyKind, type NotifyPrefs, type NotifyView } from "@galahad/core/notify";
import { type Api, isUnavailable } from "../api.ts";
import { type Ctx, errorMessage } from "../context.ts";
import { clockProblem, isIos, keyBytes, perDayProblem, PUSH_STATE_TEXT, type PushEnv, type PushState, pushState, quietLine, sameKey, todayLine, WHAT_IS_SENT } from "../lib/push.ts";
import { relativeTime } from "../lib/time.ts";
import { busy, button, section, switchControl } from "../ui/controls.ts";
import { h, replace, type Scope } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";

/*
 * Settings → Notifications: he comes to you, on this device.
 *
 * Turning it on is your act on this device: the browser's permission is asked only from
 * that tap, never when a page opens. The subscription the browser makes is handed to the
 * node as this device's, and removed when you turn it off here. What he tells you, quiet
 * hours and the day's limit are the node's settings, the same from every device.
 */

/* ---------- the browser's side ---------- */

const capable = (): boolean => isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const standalone = (): boolean => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** The service worker's registration, or null when there isn't one in time (no worker, a private window). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!capable()) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))]);
}

async function browserSubscription(): Promise<PushSubscription | null> {
  try {
    return (await (await registration())?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** What the node is handed: where this browser's push service takes messages for it, and the two keys they're encrypted to. */
function handOver(sub: PushSubscription): unknown {
  const json = sub.toJSON();
  return { endpoint: json.endpoint, expirationTime: json.expirationTime ?? null, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } };
}

async function readEnv(nodeHasThisDevice: boolean): Promise<PushEnv> {
  const can = capable();
  const sub = can ? await browserSubscription() : null;
  return { capable: can, ios: isIos(navigator), standalone: standalone(), permission: can ? Notification.permission : "default", subscribed: nodeHasThisDevice && sub !== null };
}

/** From your tap only: ask the browser's leave, subscribe to this node's key, hand the subscription to the node. */
async function turnOn(api: Api, key: string, signal?: AbortSignal): Promise<"on" | "blocked" | "dismissed"> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "dismissed";
  const reg = await registration();
  if (!reg) throw new Error("The app's service worker isn't running yet. Reload the app, then turn this on.");
  let sub = await reg.pushManager.getSubscription();
  // A subscription made for another key (the node has a new one) can't be used: it's replaced.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api.post("/api/notify/subscribe", handOver(sub), signal);
  return "on";
}

async function turnOff(api: Api, signal?: AbortSignal): Promise<void> {
  await api.post("/api/notify/unsubscribe", {}, signal);
  await (await browserSubscription())?.unsubscribe().catch(() => {});
}

/** This browser's subscription is dropped (it's being forgotten). The node drops its own when the push service says it's gone. */
export async function dropBrowserSubscription(): Promise<void> {
  await (await browserSubscription())?.unsubscribe().catch(() => {});
}

/**
 * When the app opens (and when the browser replaced the subscription): keep the node's copy current. Never asks
 * for permission, and never turns back on what was turned off: if the node no longer lists this device, the
 * browser's subscription is dropped too, so both agree.
 */
export async function syncPush(api: Api): Promise<void> {
  try {
    if (!capable() || Notification.permission !== "granted") return;
    const reg = await registration();
    let sub = (await reg?.pushManager.getSubscription()) ?? null;
    if (!reg || !sub) return;
    const view = await api.get<NotifyView>("/api/notify");
    if (!view.subscribed) {
      await sub.unsubscribe().catch(() => {});
      return;
    }
    if (!sameKey(sub.options.applicationServerKey, view.key)) {
      await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(view.key) });
    }
    await api.post("/api/notify/subscribe", handOver(sub));
  } catch {
    /* a convenience: Settings shows where things stand */
  }
}

/* ---------- the section ---------- */

const SWITCHABLE: Record<PushState, boolean> = { unsupported: false, "home-screen": false, blocked: false, off: true, on: true };

export function notificationsSection(ctx: Ctx, scope: Scope): HTMLElement | null {
  // A device that can't read the mind couldn't open anything a notification points to.
  if (!ctx.can("mind:read")) return null;
  const maySet = ctx.can("brain:write");
  const deviceCard = h("div", { class: "card rows" }, h("div", { class: "item" }, h("div", { class: "tiny subtle" }, "Looking at this device…")));
  const nodeCards = h("div", { class: "stack" });
  const el = section("Notifications", {}, deviceCard, nodeCards);
  let view: NotifyView | null = null;
  let state: PushState = "off";
  /** What the last thing you did here came to, said under the switch. */
  let note: { text: string; wrong: boolean } | null = null;

  const say = (text: string, wrong = false): void => {
    note = { text, wrong };
  };

  function renderDevice(): void {
    const on = state === "on";
    const me = view?.devices.find((d) => d.device === ctx.identity.device);
    const toggle = switchControl("Notifications on this device", on, (checked) => void flip(checked), {
      hint: on && me ? `${PUSH_STATE_TEXT.on} Through ${me.service}, turned on ${relativeTime(me.since)}.` : PUSH_STATE_TEXT[state],
      disabled: !SWITCHABLE[state] || !view,
    });
    toggle.classList.add("notify-device");
    const test = button("Send a test", { size: "sm", icon: "bell", onClick: () => void busy(test, sendTest) });
    replace(
      deviceCard,
      h("div", { class: "item notify-row", "data-state": state }, toggle),
      on ? h("div", { class: "item center notify-row" }, h("div", { class: "grow tiny subtle" }, me?.lastError ? `The last one didn't arrive: ${me.lastError}.` : "A notification to this device, now, to see that it arrives."), test) : null,
      note ? h("div", { class: "item" }, h("div", { class: note.wrong ? "error" : "tiny subtle", role: note.wrong ? "alert" : "status" }, note.text)) : null,
      h("div", { class: "item" }, icon("shield-check", { size: 16 }), h("div", { class: "grow tiny subtle" }, WHAT_IS_SENT)),
    );
  }

  function renderNode(): void {
    if (!view) return replace(nodeCards);
    const prefs = view.prefs;
    const locked = maySet ? null : "This device can't change these: it was paired without the brain:write scope.";
    const kindRow = (kind: NotifyKind) =>
      h("div", { class: "item notify-row" }, switchControl(NOTIFY_KIND_INFO[kind].label, prefs.kinds[kind], (checked) => void save({ kinds: { [kind]: checked } }), { hint: NOTIFY_KIND_INFO[kind].hint, disabled: !maySet }));

    const from = h("input", { class: "input notify-time", type: "time", value: prefs.quiet.from, disabled: !maySet || !prefs.quiet.on, "aria-label": "Quiet hours begin" });
    const to = h("input", { class: "input notify-time", type: "time", value: prefs.quiet.to, disabled: !maySet || !prefs.quiet.on, "aria-label": "Quiet hours end" });
    const hoursNote = h("div", { class: "tiny subtle", role: "status" }, quietLine(prefs));
    const setClock = (which: "from" | "to", input: HTMLInputElement) => {
      const problem = clockProblem(input.value);
      if (problem) {
        hoursNote.textContent = problem;
        hoursNote.className = "error";
        return;
      }
      if (input.value !== prefs.quiet[which]) void save({ quiet: { [which]: input.value } });
    };
    from.addEventListener("change", () => setClock("from", from));
    to.addEventListener("change", () => setClock("to", to));

    const perDay = h("input", { class: "input notify-count", type: "number", inputmode: "numeric", min: NOTIFY_PER_DAY.min, max: NOTIFY_PER_DAY.max, step: 1, value: prefs.perDay, disabled: !maySet, id: "notify-per-day", "aria-describedby": "notify-per-day-note" });
    const perDayNote = h("div", { class: "tiny subtle", id: "notify-per-day-note", role: "status" }, todayLine(view));
    perDay.addEventListener("change", () => {
      const problem = perDayProblem(perDay.value);
      if (problem) {
        perDayNote.textContent = problem;
        perDayNote.className = "error";
        return;
      }
      if (Number(perDay.value) !== prefs.perDay) void save({ perDay: Number(perDay.value) });
    });

    replace(
      nodeCards,
      h("div", { class: "stack tight" }, h("div", { class: "label" }, "What he tells you"), h("div", { class: "card rows" }, ...NOTIFY_KINDS.map(kindRow)), h("p", { class: "tiny subtle" }, "He's silent when there's nothing to say: “all quiet” is never a notification.")),
      h(
        "div",
        { class: "stack tight" },
        h("div", { class: "label" }, "When he stays silent"),
        h(
          "div",
          { class: "card rows" },
          h(
            "div",
            { class: "item notify-row wrap" },
            switchControl("Quiet hours", prefs.quiet.on, (checked) => void save({ quiet: { on: checked } }), { hint: "Everything but an alert waits until they end.", disabled: !maySet }),
            h("div", { class: "notify-hours" }, from, h("span", { class: "tiny subtle" }, "to"), to),
          ),
          h("div", { class: "item" }, hoursNote),
          h(
            "div",
            { class: "item center notify-row wrap" },
            h("div", { class: "grow", style: "min-width:200px" }, h("label", { class: "strong small", for: "notify-per-day", style: "display:block" }, "At most a day"), h("div", { class: "tiny subtle" }, "So a fault can't buzz you all day. When it's reached, one last message says so.")),
            h("div", { class: "field" }, perDay),
          ),
          h("div", { class: "item" }, perDayNote),
        ),
        locked ? h("p", { class: "tiny subtle" }, locked) : null,
      ),
      view.devices.length
        ? h(
            "div",
            { class: "stack tight" },
            h("div", { class: "label" }, "Devices he can reach"),
            h(
              "div",
              { class: "card rows" },
              ...view.devices.map((d) =>
                h(
                  "div",
                  { class: "item center" },
                  icon(/iPhone|iPad|Android|phone/i.test(d.name) ? "phone" : "laptop", { size: 16 }),
                  h("div", { class: "grow small" }, h("div", { class: "strong" }, d.name, d.device === ctx.identity.device ? h("span", { class: "tiny subtle" }, " · this device") : null), h("div", { class: "tiny subtle" }, d.lastError ? `Not arriving: ${d.lastError}` : `Through ${d.service}, turned on ${relativeTime(d.since)}`)),
                ),
              ),
            ),
          )
        : null,
    );
  }

  const render = (): void => {
    renderDevice();
    renderNode();
  };

  async function refresh(): Promise<void> {
    try {
      view = await ctx.api.get<NotifyView>("/api/notify", scope.signal);
    } catch (error) {
      if (scope.disposed) return;
      // A node from before notifications: nothing to set here yet.
      if (isUnavailable(error)) {
        el.hidden = true;
        return;
      }
      say(`Couldn't read the notification settings: ${errorMessage(error)}`, true);
    }
    state = pushState(await readEnv(view?.subscribed === true));
    if (!scope.disposed) render();
  }

  async function flip(on: boolean): Promise<void> {
    if (!view) return;
    try {
      if (on) {
        const outcome = await turnOn(ctx.api, view.key, scope.signal);
        if (outcome === "on") say("On. Send a test to see one arrive.");
        else if (outcome === "dismissed") say("Your browser didn't give its leave, so nothing changed. Turn this on again when you'd like to be asked.");
        else note = null;
      } else {
        await turnOff(ctx.api, scope.signal);
        say("Off. He won't reach this device until you turn it on again.");
      }
    } catch (error) {
      if (scope.disposed) return;
      say(`Couldn't turn notifications ${on ? "on" : "off"}: ${errorMessage(error)}`, true);
    }
    if (!scope.disposed) await refresh();
  }

  async function sendTest(): Promise<void> {
    try {
      const { sent } = await ctx.api.post<{ sent: { device: string; ok: boolean; error: string | null }[] }>("/api/notify/test", {}, scope.signal);
      const mine = sent[0];
      if (mine?.ok) say("Sent. It should be on this device in a moment (look in the notification centre if the app is open).");
      else say(`It didn't arrive: ${mine?.error ?? "no device was reached"}.`, true);
    } catch (error) {
      if (scope.disposed) return;
      say(errorMessage(error), true);
    }
    if (!scope.disposed) await refresh();
  }

  async function save(change: { kinds?: Partial<Record<NotifyKind, boolean>>; quiet?: Partial<NotifyPrefs["quiet"]>; perDay?: number }): Promise<void> {
    try {
      const { prefs } = await ctx.api.post<{ prefs: NotifyPrefs }>("/api/notify", change, scope.signal);
      if (view) view = { ...view, prefs, today: { ...view.today, limit: prefs.perDay } };
    } catch (error) {
      if (scope.disposed) return;
      say(`Couldn't save that: ${errorMessage(error)}`, true);
    }
    if (!scope.disposed) render();
  }

  void refresh();
  return el;
}
