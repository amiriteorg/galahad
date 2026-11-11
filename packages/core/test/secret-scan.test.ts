import { describe, expect, test } from "bun:test";
import { b64u, findSecrets, newNodeIdentity, randomBytes, redact } from "../src/index.ts";

describe("secret scanning", () => {
  const keys = [
    "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "sk-orca-1234567890abcdefABCDEF",
    "sk-or-v1-0123456789abcdef0123456789abcdef",
    "sk-5f3c2a1b9d8e7f6a5b4c3d2e1f0a9b8c", // DeepSeek-style
    "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    "AKIAIOSFODNN7EXAMPLE",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    `gw_${b64u(randomBytes(32))}`,
    "Xq7vB2mK9pL4wR8tZ3nC6yH1sD5fG0jQ", // unknown provider, high entropy
  ];

  test.each(keys)("catches %s", (key) => {
    expect(findSecrets(`here is my key: ${key} thanks`).length).toBeGreaterThan(0);
  });

  test("leaves ordinary text, hashes and public device ids alone", () => {
    const ordinary = [
      "Please refactor the sync engine and add tests for the vault rotation.",
      "commit 0f6a77a3c9e1b2d4f5a6b7c8d9e0f1a2b3c4d5e6 fixed it", // git sha: hex only
      `my laptop is ${newNodeIdentity().id}`,
      "https://github.com/amiriteorg/galahad/blob/main/docs/ARCHITECTURE.md",
    ];
    for (const text of ordinary) expect(findSecrets(text)).toEqual([]);
  });

  test("redaction removes known values and secret-shaped strings", () => {
    const key = "custom-provider-key-value";
    const out = redact(`401: invalid key ${key}; also sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv`, [key]);
    expect(out).not.toContain(key);
    expect(out).not.toContain("sk-ant-");
    expect(out).toContain("[redacted");
  });

  test("a key that matches two patterns is redacted once, and what follows it stays", () => {
    // An Anthropic key is also an sk-… key: overlapping findings must not eat the rest of the text.
    expect(redact("before sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE after")).toBe("before [redacted Anthropic API key] after");
  });
});
