import { describe, expect, test } from "bun:test";
import type { AnyScope } from "../types.ts";
import { homeOf, moreIndex, PLACES, placesFor, primaryOf, tabOf } from "./nav.ts";

/* Every address the app had before it was three places and More, with the scope each asked for (and Sandboxes'
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
  test("every address the app had is still a place, and More is the one that was added", () => {
    expect(ids(PLACES).filter((id) => id !== "more").sort()).toEqual(Object.keys(BEFORE).sort());
    expect(ids(PLACES)).toContain("more");
  });

  test("what a device may see follows its scopes as it did", () => {
    const sets: AnyScope[][] = [OWNER, [], ["chat"], ["mind:read"], ["chat", "mind:read"], ["fleet:admin"], ["sandbox"], ["vault:read"], ["bank:read"], ["chat", "mind:read", "vault:read"]];
    for (const scopes of sets) {
      const before = Object.entries(BEFORE).filter(([, [scope, alsoFor]]) => scope === null || scopes.includes(scope) || (alsoFor !== undefined && scopes.includes(alsoFor))).map(([id]) => id);
      expect([scopes, ids(device(...scopes)).filter((id) => id !== "more").sort()]).toEqual([scopes, before.sort()]);
    }
  });

  test("three places come first: Chat, Squires and Inbox", () => {
    expect(ids(primaryOf(device(...OWNER)))).toEqual(["chat", "team", "inbox"]);
    expect(primaryOf(device(...OWNER)).map((place) => place.label)).toEqual(["Chat", "Squires", "Inbox"]);
  });

  test("everything else is reached from More, each under exactly one heading", () => {
    const index = moreIndex(device(...OWNER));
    const listed = index.flatMap((group) => ids(group.places));
    expect(listed.sort()).toEqual(Object.keys(BEFORE).filter((id) => !["chat", "team", "inbox"].includes(id)).sort());
    expect(new Set(listed).size).toBe(listed.length);
    // A few plain headings, and each place says what's there in a line.
    expect(index.length).toBeGreaterThanOrEqual(3);
    expect(index.length).toBeLessThanOrEqual(5);
    for (const group of index) for (const place of group.places) expect([place.id, place.about.length > 8 && place.about.length <= 60]).toEqual([place.id, true]);
  });

  test("More lists only what this device may see, and a heading with nothing under it is left out", () => {
    const index = moreIndex(device("chat"));
    expect(index.flatMap((group) => ids(group.places)).sort()).toEqual(["overview", "settings"]);
    expect(index.every((group) => group.places.length > 0)).toBe(true);
  });

  test("the app opens on Chat; a device that may not chat opens on its Inbox", () => {
    expect(homeOf(device(...OWNER))).toBe("chat");
    expect(homeOf(device("mind:read"))).toBe("inbox");
    expect(ids(primaryOf(device("mind:read")))).toEqual(["inbox"]);
    expect(homeOf(device())).toBe("inbox");
  });

  test("a place reached from More keeps More marked in the navigation", () => {
    expect(tabOf("chat")).toBe("chat");
    expect(tabOf("team")).toBe("team");
    expect(tabOf("inbox")).toBe("inbox");
    for (const id of ["more", "overview", "fleet", "settings", "vault"] as const) expect([id, tabOf(id)]).toEqual([id, "more"]);
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
