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

  // A credential's name with a value that is one: still refused (narrowing the guard must not open it).
  const assignments = [
    "password=hunter2hunter2",
    "password: correct-horse-battery",
    'token: "8f2a91c4d7e3b605"',
    "api_key = 'q8Zp3LmW7rT2xK9v'",
    "export API_KEY=9f8e7d6c5b4a3210",
    'secret: "correct horse battery staple"',
    "DB_PASSWORD=Summer.2024!",
    "token=abcdefgh",
    "password = hunter(2)!x9",
    "passwd: john.smith1",
    "secret = <hunter2hunter2>",
    "password: ${DB_PASSWORD:-hunter2hunter2}",
    '{ "password": "hunter2hunter2" }',
    "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY",
  ];
  test.each(assignments)("refuses an assignment whose value is a secret: %s", (text) => {
    expect(findSecrets(`set it like this: ${text}`).map((f) => f.kind)).toContain("password assignment");
  });

  // Ordinary engineering text that names a credential without holding one (it blocked every later
  // message of a temporary chat once Galahad wrote such a line himself, since the history is resent).
  const harmless = [
    "const token = request.headers.get(\"authorization\");",
    "const token = request.headers.get(...)",
    "export API_KEY=<your-key-here>",
    "password: ${DB_PASSWORD}",
    "token: $GITHUB_TOKEN",
    "set password=%DB_PASSWORD% first",
    "apiKey: process.env.ANTHROPIC_API_KEY,",
    "token = os.environ[\"GITHUB_TOKEN\"]",
    'api_key: "{{ api_key }}"',
    "password: ********",
    "token: [redacted Anthropic API key]",
    "token: undefined",
    "in your shell: `export API_KEY=<your-key-here>`; in compose: `password: ${DB_PASSWORD}`.",
    '{ "token": "${GITHUB_TOKEN}", "max_tokens": 4096 }',
    '"integrity": "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+Tl/aTnqYuEzbJyb4gGkLGsKyE5rUY1oAv8HJTw=="',
    "integrity sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC",
  ];
  test.each(harmless)("lets through: %s", (text) => {
    expect(findSecrets(text)).toEqual([]);
  });

  test("an id the caller knows is public (an event in the mind) isn't a secret; the same shape otherwise is", () => {
    const eventId = "8SpuaToTVJa71zgvba41gtk83EkAB8nIV4TUfLJurdo";
    const text = `the ledger entry ${eventId} shows the exec`;
    expect(findSecrets(text).map((f) => f.kind)).toEqual(["high-entropy token"]);
    expect(findSecrets(text, { isPublic: (token) => token === eventId })).toEqual([]);
    // Only the token itself is vouched for: a key beside it is still found.
    const both = `${text} and sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789`;
    const kinds = findSecrets(both, { isPublic: (token) => token === eventId }).map((f) => f.kind);
    expect(kinds).toContain("Anthropic API key");
    expect(kinds).not.toContain("high-entropy token");
    // An integrity hash of the wrong length for its algorithm is just a token.
    expect(findSecrets("sha512-Xq7vB2mK9pL4wR8tZ3nC6yH1sD5fG0jQ").length).toBe(1);
  });

  test("redaction removes known values and secret-shaped strings", () => {
    const key = "custom-provider-key-value";
    const out = redact(`401: invalid key ${key}; also sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv`, [key]);
    expect(out).not.toContain(key);
    expect(out).not.toContain("sk-ant-");
    expect(out).toContain("[redacted");
  });
});
