import { describe, expect, test } from "bun:test";
import { decide } from "../src/index.ts";

describe("oath gate", () => {
  test("creating infrastructure is free; deleting it asks", () => {
    expect(decide({ class: "create", resource: "r2.bucket", target: "galahad-cache" }).verdict).toBe("allow");
    expect(decide({ class: "modify", resource: "r2.lifecycle", target: "galahad-cache" }).verdict).toBe("allow");
    expect(decide({ class: "delete", resource: "r2.bucket", target: "galahad-cache" }).verdict).toBe("ask");
  });

  test("a quest may clean up only the ephemeral things it created", () => {
    const scratch = { class: "delete" as const, resource: "docker.container", target: "squire-7" };
    expect(decide({ ...scratch, quest: "q1", createdBy: { quest: "q1", ephemeral: true } }).verdict).toBe("allow");
    expect(decide({ ...scratch, quest: "q2", createdBy: { quest: "q1", ephemeral: true } }).verdict).toBe("ask");
    expect(decide({ ...scratch, quest: "q1", createdBy: { quest: "q1", ephemeral: false } }).verdict).toBe("ask");
    expect(decide({ ...scratch, createdBy: { quest: "q1", ephemeral: true } }).verdict).toBe("ask");
  });

  test("outward always asks here: standing orders are checked against the exact call in orders.ts", () => {
    expect(decide({ class: "outward", resource: "git.push", target: "someone/repo#feat/x" })).toEqual({ verdict: "ask", reason: "outward-facing actions require your approval" });
  });

  test("forbidden is always denied", () => {
    expect(decide({ class: "forbidden", resource: "oath", target: "self" }).verdict).toBe("deny");
  });
});
