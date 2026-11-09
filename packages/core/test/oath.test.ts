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

  test("standing orders pre-approve narrowly and expire", () => {
    const orders = [
      { id: "so-1", class: "outward" as const, resource: "git.push", target: "amiriteorg/*#feat/*", expiresAt: 2_000 },
    ];
    const push = { class: "outward" as const, resource: "git.push", target: "amiriteorg/galahad#feat/mind" };
    expect(decide(push, orders, 1_000).verdict).toBe("allow");
    expect(decide({ ...push, target: "amiriteorg/galahad#main" }, orders, 1_000).verdict).toBe("ask");
    expect(decide(push, orders, 3_000).verdict).toBe("ask");
  });

  test("forbidden is always denied", () => {
    expect(decide({ class: "forbidden", resource: "oath", target: "self" }).verdict).toBe("deny");
  });
});
