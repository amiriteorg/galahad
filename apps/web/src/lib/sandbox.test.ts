import { describe, expect, test } from "bun:test";
import { autoIsolation, diskUse, gatewayUse, isLab, isolationPlan } from "./sandbox.ts";
import { gb } from "./text.ts";

const ultra = { name: "ultra", vm: true };
const laptop = { name: "laptop", vm: false };

describe("sandbox isolation", () => {
  test("Automatic picks as the node does: a microVM for online code where the host has them", () => {
    expect(autoIsolation("online", true)).toBe("vm");
    expect(autoIsolation("online", false)).toBe("container");
    expect(autoIsolation("gateway", true)).toBe("container");
    expect(autoIsolation("isolated", true)).toBe("container");
  });

  test("Automatic sends nothing, so the host decides; and says what it picks", () => {
    expect(isolationPlan("auto", "online", ultra)).toEqual({
      isolation: "vm",
      vmAvailable: true,
      vmReason: null,
      note: "Automatic: it's online, so it gets its own microVM on ultra.",
    });
    expect(isolationPlan("auto", "gateway", ultra)).toMatchObject({ isolation: "container", note: "Automatic: a hardened container on ultra's kernel. Online sandboxes get their own microVM." });
    expect(isolationPlan("auto", "online", laptop)).toMatchObject({ isolation: "container", note: expect.stringContaining("online code shares its kernel") });
    expect(isolationPlan("auto", "gateway", laptop).note).toBe("Automatic: a hardened container on laptop's kernel.");
    expect(isolationPlan("auto", "online", ultra).send).toBeUndefined();
  });

  test("a choice is sent as made; MicroVM is only available where the host has microVMs", () => {
    expect(isolationPlan("container", "online", ultra)).toMatchObject({ isolation: "container", send: "container" });
    expect(isolationPlan("vm", "gateway", ultra)).toMatchObject({ isolation: "vm", send: "vm", vmAvailable: true });
    const refused = isolationPlan("vm", "online", laptop);
    expect(refused).toMatchObject({ isolation: "container", vmAvailable: false, vmReason: "laptop can't run microVMs (it needs KVM and Kata)." });
    // Falls back to Automatic rather than asking for what the node would refuse (424).
    expect(refused.send).toBeUndefined();
  });
});

describe("the Lab", () => {
  test("a Lab sandbox is told by its image", () => {
    expect(isLab("galahad/lab:1")).toBe(true);
    expect(isLab("galahad/lab:2")).toBe(true);
    expect(isLab("galahad/sandbox:latest")).toBe(false);
    expect(isLab("someone/galahad/lab:1")).toBe(false);
    expect(isLab("galahad/laboratory:1")).toBe(false);
  });
});

describe("sandbox disks", () => {
  test("used of limit, how full, or no limit at all", () => {
    expect(diskUse(null)).toEqual({ text: "no disk limit", fraction: null, nearlyFull: false });
    expect(diskUse({ limitGb: 20, usedGb: null })).toEqual({ text: "20 GB limit", fraction: null, nearlyFull: false });
    expect(diskUse({ limitGb: 20, usedGb: 3.2 })).toEqual({ text: "3.2 GB of 20 GB", fraction: 0.16, nearlyFull: false });
    expect(diskUse({ limitGb: 20, usedGb: 18 })).toMatchObject({ text: "18 GB of 20 GB", nearlyFull: true });
    expect(diskUse({ limitGb: 2048, usedGb: 0.25 })).toMatchObject({ text: "256 MB of 2 TB" });
    // Over the limit (a filesystem's own overhead) never reads past full.
    expect(diskUse({ limitGb: 10, usedGb: 10.4 }).fraction).toBe(1);
    expect(gb(0)).toBe("0 MB");
  });
});

describe("what a sandbox may reach through its gateway", () => {
  test("web search is named for what it is, not shown as models", () => {
    expect(gatewayUse("search")).toEqual({ kind: "search", label: "web search", title: "May search the web through Galahad's own search engine" });
    expect(gatewayUse("anthropic")).toEqual({ kind: "models", label: "anthropic", title: "May use anthropic's models (your key stays in the vault)" });
  });
});
