import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApiError, apiFor, setNetworkHandler } from "./api.ts";
import type { BrowserIdentity } from "./identity.ts";

/*
 * The PWA reaches its node through `tailscale serve`. While the node restarts, the proxy
 * itself answers (502, not JSON): that is the node being away, and the app must say so
 * (and heal when it's back), not show "502 Bad Gateway" as if the node had refused.
 * A 502 the node itself sends (a connector's service unreachable) is an ordinary answer.
 */

const proxyDown = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } }) });
const nodeSays502 = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ error: "Forge unreachable: connection refused" }, { status: 502 }) });
afterAll(() => {
  proxyDown.stop(true);
  nodeSays502.stop(true);
});

let identity: BrowserIdentity;
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair;
  identity = { device: "c_test-device", privateKey: pair.privateKey, publicKey: pair.publicKey, enrolled: true, name: "Test browser" };
});

const at = (port: number) => {
  (globalThis as { location?: unknown }).location = new URL(`http://127.0.0.1:${port}/`);
};

describe("a node that is away", () => {
  test("the proxy's own 502 means the node isn't answering: the app hears 'unreachable' and a plain reason", async () => {
    const seen: boolean[] = [];
    setNetworkHandler((ok) => seen.push(ok));
    at(proxyDown.port!);
    const error = await apiFor(identity).get("/api/fleet").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toMatch(/isn't answering/);
    expect(seen).toEqual([false]);
  });

  test("a 502 from the node itself is its answer: reachable, with its own words", async () => {
    const seen: boolean[] = [];
    setNetworkHandler((ok) => seen.push(ok));
    at(nodeSays502.port!);
    const error = await apiFor(identity).post("/api/connectors/call", {}).catch((e: unknown) => e);
    expect((error as ApiError).message).toBe("Forge unreachable: connection refused");
    expect(seen).toEqual([true]);
  });
});
