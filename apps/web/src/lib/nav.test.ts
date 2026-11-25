import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnyScope } from "../types.ts";
import { countedOn, homeOf, moreIndex, PLACES, placesFor, primaryOf, railOf, routeOf, tabOf, tabsOf } from "./nav.ts";

/* Every address the app had before it was a roster and More, with the scope each asked for (and Sandboxes'
 * second one): an address is a contract, and what a device may see follows its scopes as it did. */
const BEFORE: Record<string, [scope: AnyScope | null, alsoFor?: AnyScope]> = {
  overview: [null], inbox: [null], chat: ["chat"], team: ["chat"], projects: ["mind:read"], memory: ["mind:read"], skills: ["mind:read"],
  activity: ["mind:read"], loops: ["mind:read"], artifacts: ["mind:read"], archive: ["mind:read"], findings: ["mind:read"], trials: ["mind:read"],
  fleet: ["mind:read"], sandboxes: ["sandbox", "fleet:admin"], vault: ["vault:read"], models: ["mind:read"], bank: ["bank:read"],
  connectors: ["mind:read"], settings: [null],
};
const OWNER: AnyScope[] = ["chat", "mind:read", "mind:write", "vault:read", "vault:write", "brain:write", "fleet:admin", "bank:read", "sandbox"];
const device = (...scopes: AnyScope[]) => placesFor((scope) => scopes.includes(scope));
const ids = (places: readonly { id: string }[]) => places.map((place) => place.id);

describe("the app's places", () => {
  test("every address the app had is still a place; More and Work are the ones added", () => {
    expect(ids(PLACES).filter((id) => id !== "more" && id !== "work").sort()).toEqual(Object.keys(BEFORE).sort());
    expect(ids(PLACES)).toContain("more");
    // Work (your word, 25 November 2026: "per task/per project like t3code"), for any device that may chat, as the
    // Roundtable is.
    expect(PLACES.find((place) => place.id === "work")?.scope).toBe("chat");
  });

  test("what a device may see follows its scopes as it did", () => {
    const sets: AnyScope[][] = [OWNER, [], ["chat"], ["mind:read"], ["chat", "mind:read"], ["fleet:admin"], ["sandbox"], ["vault:read"], ["bank:read"], ["chat", "mind:read", "vault:read"]];
    for (const scopes of sets) {
      const before = Object.entries(BEFORE).filter(([, [scope, alsoFor]]) => scope === null || scopes.includes(scope) || (alsoFor !== undefined && scopes.includes(alsoFor))).map(([id]) => id);
      expect([scopes, ids(device(...scopes)).filter((id) => id !== "more" && id !== "work").sort()]).toEqual([scopes, before.sort()]);
    }
  });

  test("Galahad comes first, then the work by project, then the Roundtable; the Inbox is no longer a place of its own in the navigation", () => {
    expect(ids(primaryOf(device(...OWNER)))).toEqual(["chat", "work", "team"]);
    expect(primaryOf(device(...OWNER)).map((place) => place.label)).toEqual(["Galahad", "Work", "Roundtable"]);
  });

  test("#/roundtable is the Roundtable's address as well as #/team; no other place has a second name", () => {
    const all = device(...OWNER);
    for (const hash of ["#/roundtable", "#/roundtable?room=forge", "#/team", "#/team?room=forge&tab=workspace"]) expect([hash, routeOf(hash, all)]).toEqual([hash, "team"]);
    expect(routeOf("#/fleet", all)).toBe("fleet");
    expect(routeOf("#/chat?c=cv_abc", all)).toBe("chat");
    for (const hash of ["", "#/", "#/nowhere", "#/roundtables", "#pair=abc"]) expect([hash, routeOf(hash, all)]).toEqual([hash, null]);
    // A device that may not see the Roundtable doesn't reach it by its other name either.
    expect(routeOf("#/roundtable", device("mind:read"))).toBeNull();
  });

  test("everything else is reached from More, the Inbox first, each under exactly one heading", () => {
    const index = moreIndex(device(...OWNER));
    const listed = index.flatMap((group) => ids(group.places));
    expect(listed.sort()).toEqual(Object.keys(BEFORE).filter((id) => !["chat", "team"].includes(id)).sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(index[0]!.places[0]!.id).toBe("inbox");
    // A few plain headings, and each place says what's there in a line.
    expect(index.length).toBeGreaterThanOrEqual(3);
    expect(index.length).toBeLessThanOrEqual(5);
    for (const group of index) for (const place of group.places) expect([place.id, place.about.length > 8 && place.about.length <= 60]).toEqual([place.id, true]);
  });

  test("More lists only what this device may see, and a heading with nothing under it is left out", () => {
    const index = moreIndex(device("chat"));
    expect(index.flatMap((group) => ids(group.places)).sort()).toEqual(["inbox", "overview", "settings"]);
    expect(index.every((group) => group.places.length > 0)).toBe(true);
  });

  // Your word, 23 November 2026: Galahad is the one you talk to, for nearly everything; the knights are one tap away.
  test("the app opens on Galahad, on a phone as on a wide screen; a device that may not chat opens on its Inbox", () => {
    expect(homeOf(device(...OWNER), { narrow: true })).toBe("chat");
    expect(homeOf(device(...OWNER), { narrow: false })).toBe("chat");
    for (const narrow of [true, false]) {
      expect(homeOf(device("mind:read"), { narrow })).toBe("inbox");
      expect(homeOf(device(), { narrow })).toBe("inbox");
    }
  });

  test("an app installed on a Home Screen starts where the app opens: at no address of its own, so the shell takes it home", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../manifest.webmanifest"), "utf8")) as { start_url: string; shortcuts: { url: string }[] };
    expect(manifest.start_url).toBe("/");
    // Its shortcuts are addresses the app still has.
    for (const shortcut of manifest.shortcuts) expect([shortcut.url, routeOf(shortcut.url.replace(/^\//, ""), device(...OWNER))]).not.toEqual([shortcut.url, null]);
  });

  test("a phone's bar is the Roundtable, More and Galahad at its right end; a device with no roster has its Inbox there", () => {
    // Your word, 23 November 2026: Galahad the right-most in the bar (the app still opens on him).
    expect(ids(tabsOf(device(...OWNER)))).toEqual(["work", "more", "chat"]);
    expect(ids(tabsOf(device("chat")))).toEqual(["work", "more", "chat"]);
    expect(tabsOf(device(...OWNER)).map((tab) => tab.label)).toEqual(["Work", "More", "Galahad"]);
    expect(homeOf(device(...OWNER), { narrow: true })).toBe("chat");
    expect(ids(tabsOf(device("mind:read")))).toEqual(["inbox", "more"]);
    expect(ids(tabsOf(device()))).toEqual(["inbox", "more"]);
  });

  test("what waits in the Inbox is counted on Galahad's tab, at the bar's right end; with no Galahad, on the Inbox's own", () => {
    expect(countedOn(tabsOf(device(...OWNER)))).toBe("chat");
    expect(countedOn(tabsOf(device("chat")))).toBe("chat");
    expect(countedOn(tabsOf(device("mind:read")))).toBe("inbox");
    expect(countedOn([])).toBeNull();
  });

  test("a place reached from More keeps More marked, and a timeline keeps the roster marked", () => {
    const tabs = tabsOf(device(...OWNER));
    expect(tabOf("chat", tabs)).toBe("chat");
    // The Roundtable and a knight's or a room's timeline keep Work marked: they are where its tasks are worked.
    expect(tabOf("work", tabs)).toBe("work");
    expect(tabOf("team", tabs)).toBe("work");
    for (const id of ["more", "inbox", "overview", "fleet", "settings", "vault"] as const) expect([id, tabOf(id, tabs)]).toEqual([id, "more"]);
    // On a device whose bar holds the Inbox, the Inbox marks itself.
    expect(tabOf("inbox", tabsOf(device("mind:read")))).toBe("inbox");
    expect(tabOf("fleet", tabsOf(device("mind:read")))).toBe("more");
  });

  test("a wide screen reaches every place in one click: the rail holds each one this device may see but the roster's and More, by heading, Settings at its foot", () => {
    const rail = railOf(device(...OWNER));
    expect(rail.groups.map(ids)).toEqual(moreIndex(device(...OWNER)).filter((group) => group.heading !== "This device").map((group) => ids(group.places)));
    expect(ids(rail.foot)).toEqual(["settings"]);
    const onRail: string[] = [...rail.groups.flat(), ...rail.foot].map((place) => place.id);
    expect(onRail.sort()).toEqual(ids(device(...OWNER)).filter((id) => !["chat", "work", "team", "more"].includes(id)).sort());
    // The Inbox leads it, where what needs you is counted.
    expect(rail.groups[0]![0]!.id).toBe("inbox");
    // A device that may only chat sees only what it may open.
    expect([...railOf(device("chat")).groups.flat(), ...railOf(device("chat")).foot].map((place) => place.id).sort()).toEqual(["inbox", "overview", "settings"]);
  });

  test("every place has its own key after G, and none is G itself", () => {
    const keys = PLACES.map((place) => place.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("g");
    // The keys people already know still go where they went.
    const key = (id: string) => PLACES.find((place) => place.id === id)!.key;
    expect([key("overview"), key("inbox"), key("chat"), key("team"), key("fleet"), key("settings")]).toEqual(["o", "i", "c", "h", "f", ","]);
  });
});
