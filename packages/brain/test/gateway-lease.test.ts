import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { GatewayTokens } from "../src/index.ts";

/*
 * A lease kept while its work runs (GatewayTokens.extend): the same token, valid longer and with more requests, so
 * whatever holds it works on. Never one that lapsed or was revoked.
 */

test("kept: the same token, valid its minutes more from now, and its requests more than it has used", () => {
  let now = 1_000_000;
  const tokens = new GatewayTokens(new Database(":memory:"), () => now);
  const { token, info } = tokens.mint({ label: "sandbox:0123456789", providers: ["local"], ttlMinutes: 30, maxRequests: 2 });
  expect(tokens.consume(token, "local")).toEqual({ ok: true });
  expect(tokens.consume(token, "local")).toEqual({ ok: true });
  expect(tokens.consume(token, "local")).toEqual({ ok: false, reason: "token request budget exhausted" });
  now += 20 * 60_000;
  expect(tokens.extend(info.hash, { ttlMinutes: 30, maxRequests: 2 })).toBe(true);
  // Twenty-nine minutes after it was kept, forty-nine after it was made: still good, with two requests more.
  now += 29 * 60_000;
  expect(tokens.consume(token, "local")).toEqual({ ok: true });
  expect(tokens.consume(token, "local")).toEqual({ ok: true });
  expect(tokens.consume(token, "local")).toEqual({ ok: false, reason: "token request budget exhausted" });
  // Its scope is what it was: never another provider's.
  expect(tokens.consume(token, "other")).toEqual({ ok: false, reason: "token not valid for other" });
  now += 2 * 60_000;
  expect(tokens.consume(token, "local")).toEqual({ ok: false, reason: "token expired" });
});

test("never brought back: one that lapsed, or was revoked, stays so", () => {
  let now = 1_000_000;
  const tokens = new GatewayTokens(new Database(":memory:"), () => now);
  const lapsed = tokens.mint({ label: "sandbox:a", ttlMinutes: 30, maxRequests: 5 });
  const revoked = tokens.mint({ label: "sandbox:b", ttlMinutes: 30, maxRequests: 5 });
  tokens.revoke(revoked.info.hash);
  now += 31 * 60_000;
  expect(tokens.extend(lapsed.info.hash, { ttlMinutes: 30, maxRequests: 5 })).toBe(false);
  expect(tokens.extend(revoked.info.hash, { ttlMinutes: 30, maxRequests: 5 })).toBe(false);
  expect(tokens.consume(lapsed.token, "local")).toEqual({ ok: false, reason: "token expired" });
  expect(tokens.consume(revoked.token, "local")).toEqual({ ok: false, reason: "unknown token" });
});
