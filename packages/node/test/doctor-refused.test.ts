import { describe, expect, test } from "bun:test";
import { newNodeIdentity } from "@galahad/core";
import { foundFleet, MindStore, Vault } from "@galahad/mind";
import { refusedKeysOf, refusalsStillSaid } from "@galahad/brain";
import { type Diagnosis, type DoctorFacts, diagnose } from "../src/doctor.ts";

/*
 * A provider that refuses its key: the doctor says each one still remembered, as needs you, with what to do. A refusal
 * from before the provider's key was last set is not said (the key was replaced since). Its heartbeat finding is raised
 * once, as the doctor's other findings are.
 */

const NOW = Date.UTC(2026, 10, 22, 1, 28);

function base(): DoctorFacts {
  return {
    now: NOW,
    quick: false,
    offline: false,
    self: { id: "n_self", name: "ultra", fleetName: "camelot", active: true, role: "full", alwaysOn: true, startedAt: NOW - 3 * 86_400_000 },
    keys: { keystore: "file", keyFile: { exists: true, mode: 0o600 }, home: { exists: true, mode: 0o700 }, adminToken: { exists: true, mode: 0o600 } },
    mind: { events: 1000, integrity: "ok", head: null, forks: [], newestEventAt: NOW - 1000, timeSynced: true, peers: [], backup: null },
    vault: { unlocked: true, secrets: 3, requests: [] },
    providers: { setUp: 2, byDefault: ["deepseek", "mimo-token"] },
    roles: [
      { role: "planner", chats: true, models: [{ ref: "deepseek/deepseek-chat", problem: null }], probe: { ref: "deepseek/deepseek-chat", ok: true, ms: 800, error: null } },
      { role: "engineer", chats: true, models: [{ ref: "deepseek/deepseek-chat", problem: null }], probe: { ref: "deepseek/deepseek-chat", ok: true, ms: 800, error: null } },
    ],
    archive: null,
    sandbox: { host: null, others: [] },
    compute: null,
    loops: [],
    connectors: [],
    app: { missing: [], published: null, local: "http://127.0.0.1:7778" },
    disk: null,
    service: { restarts: 0, warnings: [] },
  };
}

const byId = (checks: Diagnosis[], id: string): Diagnosis => {
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}; there are: ${checks.map((c) => c.id).join(", ")}`);
  return found;
};
const hasId = (checks: Diagnosis[], id: string): boolean => checks.some((c) => c.id === id);

describe("a provider that refused its key", () => {
  test("no refusal remembered: no refused-key lines", () => {
    const checks = diagnose(base());
    expect(checks.filter((c) => c.id.startsWith("models.key."))).toEqual([]);
  });

  test("a coding plan that names other regions: said once, needs you, with the key add and its region's address", () => {
    const facts = base();
    facts.refused = [{ provider: "mimo-token", at: NOW, said: "401: Invalid API Key" }];
    const checks = diagnose(facts);
    expect(checks.filter((c) => c.id === "models.key.mimo-token")).toHaveLength(1);
    const refused = byId(checks, "models.key.mimo-token");
    expect(refused.area).toBe("models");
    expect(refused.state).toBe("needs-you");
    expect(refused.line).toBe("mimo-token refused its key at 01:28 UTC: 401: Invalid API Key");
    expect(refused.fix).toContain("galahad key add --provider mimo-token");
    expect(refused.fix).toContain("--base-url");
    expect(refused.finding).toMatchObject({ severity: "warn", title: "mimo-token refused its key" });
    expect(refused.finding!.body).toContain("mimo-token refused its key at 01:28 UTC: 401: Invalid API Key");
    expect(refused.finding!.key).toBe("doctor:models.key.mimo-token:n_self");
  });

  test("an ordinary provider: the key add, and no word of a plan's region", () => {
    const facts = base();
    facts.refused = [{ provider: "deepseek", at: NOW, said: "403: Forbidden" }];
    const refused = byId(diagnose(facts), "models.key.deepseek");
    expect(refused.state).toBe("needs-you");
    expect(refused.line).toBe("deepseek refused its key at 01:28 UTC: 403: Forbidden");
    expect(refused.fix).toBe("Replace the key: galahad key add --provider deepseek.");
    expect(refused.fix).not.toContain("--base-url");
    expect(hasId(diagnose(facts), "models.key.mimo-token")).toBe(false);
  });
});

describe("a refusal from before the key was last set", () => {
  function keyedBrain() {
    const id = "mimo-token";
    const identity = newNodeIdentity();
    const store = new MindStore(":memory:");
    foundFleet(store, identity, { fleetName: "camelot", nodeName: "n" });
    const vault = new Vault(store, identity);
    const baseUrl = "https://plan.invalid/v1";
    vault.set(id, ["FAKE", "mimo", "key"].join("-"), { provider: id, origin: new URL(baseUrl).origin });
    store.emit(identity, "provider.set", { id, kind: "openai", baseUrl, secret: id });
    return { store, vault, baseUrl };
  }

  test("is not said: the key was replaced since", () => {
    const { store, vault } = keyedBrain();
    const refusals = refusedKeysOf(store);
    refusals.now = () => Date.now() - 60_000;
    refusals.note("mimo-token", '401 {"error":{"message":"Invalid API Key"}}');
    // The remembered refusal stays, but what the doctor says leaves it out.
    expect(refusals.list()).toHaveLength(1);
    expect(refusalsStillSaid(store, vault)).toEqual([]);
  });

  test("is said while the key that was refused is still the one set; setting it again leaves it out", async () => {
    const { store, vault, baseUrl } = keyedBrain();
    const refusals = refusedKeysOf(store);
    refusals.now = () => Date.now();
    refusals.note("mimo-token", '401 {"error":{"message":"Invalid API Key"}}');
    expect(refusalsStillSaid(store, vault)).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 10));
    vault.set("mimo-token", ["FAKE", "mimo", "key", "new"].join("-"), { provider: "mimo-token", origin: new URL(baseUrl).origin });
    expect(refusalsStillSaid(store, vault)).toEqual([]);
  });
});
