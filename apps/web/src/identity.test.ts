import { afterAll, beforeAll, describe, expect, test } from "bun:test";

/*
 * This browser's key lives in IndexedDB. A store that can't be read right now (Safari
 * drops its storage connection after a Home Screen app sleeps; a private window may
 * refuse it) must never look like "not paired": the welcome screen would then offer to
 * pair again, and pairing writes a new key over the enrolled one.
 */

type Req = { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void };
let failOpens = 0;
let stored: unknown = undefined;
let opens = 0;

const fakeDb = {
  transaction: () => ({
    objectStore: () => ({
      get: () => {
        const r: Req = {};
        queueMicrotask(() => {
          r.result = stored;
          r.onsuccess?.();
        });
        return r;
      },
    }),
  }),
  close: () => {},
};

const saved = (globalThis as { indexedDB?: unknown }).indexedDB;
beforeAll(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open: () => {
      opens++;
      const r: Req = {};
      setTimeout(() => {
        if (failOpens > 0) {
          failOpens--;
          r.error = new Error("Connection to Indexed Database server lost. Refresh the page to try again");
          r.onerror?.();
        } else {
          r.result = fakeDb;
          r.onsuccess?.();
        }
      }, 0);
      return r;
    },
  };
});
afterAll(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = saved;
});

describe("this browser's key", () => {
  test("no key stored: nothing to load (pairing may make one)", async () => {
    const { loadIdentity } = await import("./identity.ts");
    stored = undefined;
    failOpens = 0;
    expect(await loadIdentity()).toBeNull();
  });

  test("a store that fails once is tried again, and the key is found", async () => {
    const { loadIdentity } = await import("./identity.ts");
    stored = { device: "c_test", enrolled: true, name: "Test browser" };
    failOpens = 1;
    opens = 0;
    expect((await loadIdentity())?.device).toBe("c_test");
    expect(opens).toBe(2);
  });

  test("a store that can't be read is an error, never 'not paired'", async () => {
    const { loadIdentity, KeyStoreUnavailable } = await import("./identity.ts");
    stored = { device: "c_test", enrolled: true, name: "Test browser" };
    failOpens = 10;
    await expect(loadIdentity()).rejects.toBeInstanceOf(KeyStoreUnavailable);
    failOpens = 0;
  });
});
