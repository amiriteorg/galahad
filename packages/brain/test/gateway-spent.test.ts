import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { newNodeIdentity } from "@galahad/core";
import { foundFleet, MindStore, Vault } from "@galahad/mind";
import { GatewayTokens, handleGateway, windowsOf } from "../src/index.ts";

/*
 * A plan whose allowance is spent, through the gateway (#31). Told by its provider to try again in a day and a half,
 * OpenCode 2.3.0 waits fifteen minutes and tries again, and again, and Codex 0.169.0 waits the whole of it: a knight's
 * task stalls at "limit reached" (measured 21 Nov 2026 against a stand-in). Told 402, each ends within seconds, as Claude
 * Code does either way, and the next model on the knight's list takes over. So a refusal that says the allowance is
 * spent past the next minute is remembered (windows.ts), said to the tool as a spent quota without a time to wait for,
 * and not asked of its provider again until it resets. A shorter wait stays the provider's, for the tool to wait out.
 */

const KEY = ["FAKE", "plan", "key"].join("-");
const GO = '{"type":"error","error":{"type":"GoUsageLimitError","message":"OpenCode Go usage limit reached (5-hour, resets in 1h 37m). To keep going now, turn on Extra Usage."}}';

function gateway(answer: () => Response) {
  const listing = () => Response.json({ data: [{ id: "glm-5.3" }] });
  const identity = newNodeIdentity();
  const store = new MindStore(":memory:");
  foundFleet(store, identity, { fleetName: "camelot", nodeName: "ultra" });
  const vault = new Vault(store, identity);
  const baseUrl = "https://plan.invalid/v1";
  vault.set("opencode-go", KEY, { provider: "opencode-go", origin: new URL(baseUrl).origin });
  store.emit(identity, "provider.set", { id: "opencode-go", kind: "openai", baseUrl, secret: "opencode-go" });
  const tokens = new GatewayTokens(new Database(":memory:"));
  const { token } = tokens.mint({ label: "sandbox:0123456789", providers: ["opencode-go"], ttlMinutes: 10, maxRequests: 20 });
  const asked: string[] = [];
  const ctx = {
    store,
    vault,
    tokens,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      asked.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
      return init?.method === "POST" ? answer() : listing();
    }) as typeof fetch,
  };
  let now = 1_795_262_400_000;
  windowsOf(store).now = () => now;
  const call = () => handleGateway(new Request("http://127.0.0.1:7777/gw/opencode-go/chat/completions", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ model: "glm-5.3", messages: [] }) }), ctx);
  const list = () => handleGateway(new Request("http://127.0.0.1:7777/gw/opencode-go/models", { headers: { authorization: `Bearer ${token}` } }), ctx);
  return { store, asked, call, list, later: (ms: number) => (now += ms), now: () => now };
}

const messageOf = async (response: Response) => ((await response.json()) as { error: { message: string } }).error.message;

test("a plan's refusal that says its allowance is spent: said as a spent quota with no time to wait for, and not asked again until it resets", async () => {
  const g = gateway(() => new Response(GO, { status: 429, headers: { "content-type": "application/json", "retry-after": "5820" } }));
  const first = await g.call();
  expect(first.status).toBe(402);
  expect(first.headers.get("retry-after")).toBeNull();
  const said = await messageOf(first);
  expect(said).toContain("opencode-go's allowance is spent until");
  expect(said).toContain("UTC (1h 37m from now)");
  // Not in the words a tool takes for a wait (Hermes reads "usage limit" or "quota" with "resets in" as one): final.
  expect(said).not.toMatch(/usage limit|quota|limit exceeded|resets? in|try again|retry|wait/i);
  // Remembered as chat remembers one, and kept by the node (the meter says it).
  expect(windowsOf(g.store).spent("opencode-go")).toMatchObject({ until: g.now() + 97 * 60_000, said: expect.stringContaining("resets in 1h 37m") });

  // Asked again in the window, it isn't asked of the provider: refused at once, the same way.
  g.later(30 * 60_000);
  const again = await g.call();
  expect(again.status).toBe(402);
  expect(await messageOf(again)).toContain("(1h 7m from now)");
  expect(g.asked).toEqual(["POST /v1/chat/completions"]);
  // Only model calls are held back: a tool's look at the model list still gets the provider's answer.
  await g.list();
  expect(g.asked).toEqual(["POST /v1/chat/completions", "GET /v1/models"]);

  // Reset, it is asked again.
  g.later(68 * 60_000);
  await g.call();
  expect(g.asked.at(-1)).toBe("POST /v1/chat/completions");
  expect(g.asked).toHaveLength(3);
});

test("a refusal that gives only a long time to try again in is a spent window too; a short one stays the provider's", async () => {
  let wait = "7200";
  const g = gateway(() => new Response('{"error":{"message":"Too Many Requests"}}', { status: 429, headers: { "content-type": "application/json", "retry-after": wait } }));
  const long = await g.call();
  expect(long.status).toBe(402);
  expect(await messageOf(long)).toContain("(2h from now)");
  expect(windowsOf(g.store).spent("opencode-go")?.until).toBe(g.now() + 2 * 3_600_000);

  // A minute or less to wait: the tool's own retry waits it out, on the same model.
  g.later(2 * 3_600_000 + 1);
  wait = "20";
  const short = await g.call();
  expect(short.status).toBe(429);
  expect(short.headers.get("retry-after")).toBe("20");
  expect(await short.text()).toContain("Too Many Requests");
  // And it is asked again when the tool tries again.
  await g.call();
  expect(g.asked).toHaveLength(3);
});

test("a window told elsewhere (a reviewer's call through chat) holds the gateway's calls back too", async () => {
  const g = gateway(() => Response.json({ choices: [{ message: { content: "aye" } }] }));
  windowsOf(g.store).note("opencode-go", `opencode-go → 429 ${GO}`);
  const refused = await g.call();
  expect(refused.status).toBe(402);
  expect(g.asked).toEqual([]);
  // Once it resets, the provider is asked again.
  windowsOf(g.store).now = () => g.now() + 98 * 60_000;
  expect((await g.call()).status).toBe(200);
});
