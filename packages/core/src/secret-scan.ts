/*
 * Secrets never travel through chat or memory. Chat goes to model providers and
 * memory replicates in plaintext to every device, so anything that looks like a
 * credential is stopped at the door and redirected to the vault.
 */

export interface SecretFinding {
  kind: string;
  index: number;
  length: number;
}

const PATTERNS: [kind: string, pattern: RegExp][] = [
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ["OrcaRouter API key", /sk-orca-[A-Za-z0-9_-]{16,}/g],
  ["OpenRouter API key", /sk-or-[A-Za-z0-9_-]{20,}/g],
  ["API key (sk-…)", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{30,}/g],
  ["private key", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g],
  ["Galahad gateway token", /\bgw_[A-Za-z0-9_-]{43}\b/g],
  ["Galahad admin token", /\badm_[A-Za-z0-9_-]{43}\b/g],
  ["Galahad invite", /\bgi1\.[A-Za-z0-9_-]{40,}/g],
  ["password assignment", /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{8,}/gi],
];

/** Shannon entropy in bits per character. */
function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Standalone, mixed-character, high-entropy tokens (catches keys without a known prefix). */
function highEntropyTokens(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const match of text.matchAll(/(?<![A-Za-z0-9_+/=.-])[A-Za-z0-9_+/=-]{32,200}(?![A-Za-z0-9_+/=.-])/g)) {
    const token = match[0];
    if (/^[nc]_/.test(token)) continue; // Galahad device ids are public keys
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((re) => re.test(token)).length;
    if (classes >= 3 && entropy(token) > 4.2) out.push({ kind: "high-entropy token", index: match.index!, length: token.length });
  }
  return out;
}

export function findSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [kind, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) findings.push({ kind, index: match.index!, length: match[0].length });
  }
  for (const finding of highEntropyTokens(text)) {
    if (!findings.some((f) => finding.index < f.index + f.length && f.index < finding.index + finding.length)) {
      findings.push(finding);
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

/** Replace known secret values and anything secret-shaped with a marker. */
export function redact(text: string, knownValues: (string | null | undefined)[] = []): string {
  let out = text;
  for (const value of knownValues) if (value && value.length >= 6) out = out.split(value).join("[redacted]");
  const findings = findSecrets(out);
  for (const f of [...findings].reverse()) out = `${out.slice(0, f.index)}[redacted ${f.kind}]${out.slice(f.index + f.length)}`;
  return out;
}

export const SECRET_REDIRECT =
  "Secrets never go into chat or memory. Add it to the vault instead: the PWA's Vault page, or `galahad key add` in a terminal.";
