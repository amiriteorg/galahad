import { describe, expect, test } from "bun:test";
import { NOTIFY_DEFAULTS } from "@galahad/core/notify";
import { clockProblem, isIos, keyBytes, perDayProblem, type PushEnv, pushState, quietLine, readOpenMessage, sameKey, todayLine } from "./push.ts";

/* Notifications on this device: the state it's in, and the checks the Settings fields make. */

const env = (over: Partial<PushEnv> = {}): PushEnv => ({ capable: true, ios: false, standalone: false, permission: "default", subscribed: false, ...over });

describe("which state this device is in", () => {
  test("off until you turn it on; on only with the browser's leave and a subscription the node keeps", () => {
    expect(pushState(env())).toBe("off");
    expect(pushState(env({ permission: "granted" }))).toBe("off");
    expect(pushState(env({ permission: "granted", subscribed: true }))).toBe("on");
    // The node may still list this device while the browser has taken its leave back.
    expect(pushState(env({ permission: "default", subscribed: true }))).toBe("off");
  });

  test("blocked when the browser said no; unsupported when it can't at all", () => {
    expect(pushState(env({ permission: "denied" }))).toBe("blocked");
    expect(pushState(env({ permission: "denied", subscribed: true }))).toBe("blocked");
    expect(pushState(env({ capable: false }))).toBe("unsupported");
  });

  test("an iPhone or iPad: only from the Home Screen, and the page says how to get there", () => {
    expect(pushState(env({ ios: true, capable: false }))).toBe("home-screen");
    expect(pushState(env({ ios: true, capable: true }))).toBe("home-screen");
    expect(pushState(env({ ios: true, standalone: true, capable: true }))).toBe("off");
    expect(pushState(env({ ios: true, standalone: true, capable: true, permission: "granted", subscribed: true }))).toBe("on");
    // An iPhone on a system from before web push, even on the Home Screen.
    expect(pushState(env({ ios: true, standalone: true, capable: false }))).toBe("unsupported");
    expect(isIos({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)" })).toBe(true);
    expect(isIos({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isIos({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/141.0" })).toBe(false);
  });
});

describe("a tapped notification, as the service worker tells an open page", () => {
  test("one of the app's places, and a kept chat for the chat page; anything else is no message of ours", () => {
    const chat = "cv_1234567890123456789012";
    expect(readOpenMessage({ type: "galahad:open", open: "inbox", conversation: null })).toEqual({ route: "inbox" });
    expect(readOpenMessage({ type: "galahad:open", open: "chat", conversation: chat })).toEqual({ route: "chat", conversation: chat });
    // A chat only goes with the chat page, and only when it reads as one.
    expect(readOpenMessage({ type: "galahad:open", open: "journal", conversation: chat })).toEqual({ route: "journal" });
    expect(readOpenMessage({ type: "galahad:open", open: "chat", conversation: "<script>" })).toEqual({ route: "chat" });
    for (const bad of [null, "galahad:open", { type: "galahad:updated" }, { type: "galahad:open", open: "vault" }, { type: "galahad:open", open: "https://evil.example" }, { type: "galahad:open" }]) {
      expect(readOpenMessage(bad)).toBeNull();
    }
  });
});

describe("the node's key", () => {
  test("base64url to the bytes a browser takes, and whether a subscription was made for it", () => {
    const key = "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs";
    const bytes = keyBytes(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
    expect(sameKey(bytes.buffer, key)).toBe(true);
    const other = bytes.slice();
    other[10]! ^= 1;
    expect(sameKey(other.buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
    expect(sameKey(bytes.slice(0, 64).buffer, key)).toBe(false);
  });
});

describe("the settings' own checks, before anything is sent", () => {
  test("a time of day and a day's limit", () => {
    expect(clockProblem("22:00")).toBeNull();
    expect(clockProblem("07:05")).toBeNull();
    for (const bad of ["24:00", "7:00", "22.00", "", "10pm"]) expect(clockProblem(bad)).toBe("A time of day, like 22:00.");
    expect(perDayProblem("12")).toBeNull();
    expect(perDayProblem(" 1 ")).toBeNull();
    for (const bad of ["0", "51", "3.5", "-2", "many", ""]) expect(perDayProblem(bad)).toBe("A whole number from 1 to 50.");
  });

  test("in a line: quiet hours, and today", () => {
    expect(quietLine(NOTIFY_DEFAULTS)).toBe("From 22:00 to 07:00, Europe/Copenhagen time, everything but an alert waits; then one message says what waited.");
    expect(quietLine({ ...NOTIFY_DEFAULTS, quiet: { ...NOTIFY_DEFAULTS.quiet, on: false } })).toBe("No quiet hours: he tells you whenever it happens.");
    expect(todayLine({ today: { day: "2026-11-12", sent: [], count: 0, limit: 12 }, quiet: false, held: 0 })).toBe("Nothing sent today.");
    expect(todayLine({ today: { day: "2026-11-12", sent: [], count: 3, limit: 12 }, quiet: true, held: 2 })).toBe("3 of 12 sent today; 2 things wait for quiet hours to end.");
    expect(todayLine({ today: { day: "2026-11-12", sent: [], count: 3, limit: 12 }, quiet: true, held: 1 })).toBe("3 of 12 sent today; 1 thing waits for quiet hours to end.");
  });
});
