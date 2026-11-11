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
];

/**
 * A credential's name (`password`, `DB_PASSWORD`, `api-key`, `access_token`…), `:` or `=`, and
 * its value: quoted, or up to the next space.
 */
const ASSIGNMENT =
  /\b(?:[A-Za-z0-9]+[_-])*(?:password|passwd|secret|api[_-]?key|access[_-]?key|token)\b["']?\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|`[^`\n]*`|\S+)/gi;

const NAME = String.raw`[A-Za-z_$][\w$]*`;
/** Words a value is named after when it's a variable, not the thing itself. */
const CREDENTIAL_WORD = /(?:password|passwd|secret|key|token|credential|auth)s?$/i;
/** Where a value comes from when it's read in code: the environment, configuration, the caller. */
const CODE_ROOT = /^(?:process|os|env|environ|config|cfg|settings|options|opts|ctx|context|this|self|req|request|args|params|props|import)$/;

/**
 * Not a credential, though it sits where one would: a reference to where it's kept, a
 * placeholder, a call that fetches it. Deliberately narrow (when in doubt, it's a secret):
 * a bare word, a number or anything with a literal default in it is still refused.
 */
function notACredential(value: string): boolean {
  if (value.length < 8) return true; // too short to be a key (as before)
  if (/^\$\{(?:[A-Za-z_]+[.:])?[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)) return true; // ${DB_PASSWORD}, ${env:TOKEN}
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return true; // $GITHUB_TOKEN
  if (/^%[A-Za-z_][A-Za-z0-9_]*%$/.test(value)) return true; // %DB_PASSWORD%
  if (/^\{\{\s*[A-Za-z_][\w.]*\s*\}\}$/.test(value)) return true; // {{ api_key }}
  if (/^<[A-Za-z][A-Za-z _-]*>$/.test(value)) return true; // <your-key-here>
  if (/^(?:\*{4,}|x{4,}|X{4,}|•{4,}|\.{3,}|…)$/.test(value)) return true; // masked
  if (/^\[redacted\b/i.test(value)) return true; // what redact() leaves
  if (/^(?:undefined|null|none|nil|true|false)$/i.test(value)) return true;
  if (/^your[-_]?(?:[a-z]+[-_]?)*(?:key|token|secret|password)(?:[-_]?here)?$/i.test(value)) return true; // your-key-here
  const path = new RegExp(`^(${NAME}(?:\\??\\.${NAME})*)(.*)$`).exec(value);
  if (path) {
    const [, dotted, rest] = path as unknown as [string, string, string];
    const parts = dotted.split(/\??\./);
    const leaf = parts.at(-1)!;
    // A call that fetches it: request.headers.get(…), os.getenv("TOKEN"), getToken(). Closed, with
    // nothing after it, or (a method, cut at a space) open.
    const call = /^\((?:[^()]|\([^()]*\))*(\))?[,;)]*$/.exec(rest);
    if (call && (call[1] ? parts.length > 1 || /^[a-z_$]/.test(dotted) : parts.length > 1)) return true;
    // Read from somewhere: process.env.API_KEY, config.token, os.environ["TOKEN"]
    const read = parts.length > 1 && (CODE_ROOT.test(parts[0]!) || CREDENTIAL_WORD.test(leaf));
    if (read && /^(?:\[\s*["'][A-Za-z0-9_]+["']\s*\])?[,;)]*$/.test(rest)) return true;
    if (CODE_ROOT.test(dotted) && /^\[\s*["'][A-Za-z0-9_]+["']\s*\][,;)]*$/.test(rest)) return true;
  }
  return false;
}

function assignments(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const match of text.matchAll(ASSIGNMENT)) {
    const raw = match[1]!;
    const quoted = /^(["'`]).*\1$/s.test(raw);
    // Unquoted, it ends where the sentence or the Markdown does: `export API_KEY=<key>`; …
    const value = quoted ? raw.slice(1, -1) : raw.replace(/[`'".,;:!?]+$/, "");
    if (!notACredential(value)) out.push({ kind: "password assignment", index: match.index!, length: match[0].length });
  }
  return out;
}

/** Subresource integrity (npm's lockfiles, <script integrity>): a hash, exactly its length. */
const INTEGRITY: Record<string, number> = { sha256: 44, sha384: 64, sha512: 88 };
function isIntegrityHash(token: string): boolean {
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(token);
  return !!match && match[2]!.length === INTEGRITY[match[1]!];
}

export interface ScanOptions {
  /** Tokens the caller knows to be public, such as the ids of events in its mind. */
  isPublic?: (token: string) => boolean;
}

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
function highEntropyTokens(text: string, opts: ScanOptions): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const match of text.matchAll(/(?<![A-Za-z0-9_+/=.-])[A-Za-z0-9_+/=-]{32,200}(?![A-Za-z0-9_+/=.-])/g)) {
    const token = match[0];
    if (/^[nc]_/.test(token)) continue; // Galahad device ids are public keys
    if (isIntegrityHash(token)) continue;
    if (opts.isPublic?.(token)) continue;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((re) => re.test(token)).length;
    if (classes >= 3 && entropy(token) > 4.2) out.push({ kind: "high-entropy token", index: match.index!, length: token.length });
  }
  return out;
}

export function findSecrets(text: string, opts: ScanOptions = {}): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [kind, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) findings.push({ kind, index: match.index!, length: match[0].length });
  }
  findings.push(...assignments(text));
  for (const finding of highEntropyTokens(text, opts)) {
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
