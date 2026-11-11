import { describe, expect, test } from "bun:test";
import { findSecrets, redact } from "../src/secret-scan.ts";

/*
 * Review of t3/stability-speed-fixes-batch: credentials in the new "allowed" shapes. Every one
 * of these was refused on main; the values are fake but shaped like real ones.
 */

describe("review: a reference with a literal credential beside it is still a credential", () => {
  const refusedOnMain = [
    // A literal default after the reference: the value is cut at the space, so the literal is never looked at.
    'password = os.getenv("PW", "Tr0ub4dor&3xyz")',
    'const password = process.env.DB_PASSWORD || "Winter2024hunter";',
    'const apiKey = process.env.API_KEY ?? "a8F3kL9mQ2xR7vB1";',
    // Passwords that happen to look like a reference or a placeholder.
    "password=$uperman1234",
    "my password: $ecretPa55word",
    "password: config.Tr0ub4dor3x",
    "password=Summer2024.Secret",
    "token=[REDACTED]realtoken12345",
  ];
  for (const text of refusedOnMain) {
    test(`refused: ${text}`, () => {
      expect(findSecrets(text).length).toBeGreaterThan(0);
    });
  }

  test("redaction (connector answers, logs) still hides a literal default", () => {
    expect(redact('const password = process.env.DB_PASSWORD || "Winter2024hunter";')).not.toContain("Winter2024hunter");
  });
});
