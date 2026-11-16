import { type ProviderView, sha256B64u } from "@galahad/core";
import type { MindStore, Vault } from "@galahad/mind";

export type ProviderKind = "openai" | "anthropic";

export interface ProviderPreset {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Key prefixes that identify this provider when you just paste a key. */
  keyPrefixes?: string[];
  /** Runs on the node itself (no key, nothing leaves the machine). */
  local?: boolean;
  note?: string;
  /** A subscription sold for coding tools, not the vendor's ordinary API (see CodingPlan). */
  plan?: CodingPlan;
}

/**
 * A coding plan: a flat-rate subscription whose key is for coding (its terms say so, and name
 * tools), not for calling the API from any program for anything. Galahad and the knights are a
 * coding tool, by their owner's word: he calls a plan himself for coding work (a quest's planner,
 * engineer and reviewer, a knight at its work), under his own name (SELF), and lends it through
 * the gateway to the other coding tools in the knights' VMs and under `galahad run`, each calling
 * as itself. Nothing else he does is handed its key: not his talk with you, his loops or his
 * heartbeat (chat.ts, resolveProvider). What a plan allows is its vendor's to say, and changes:
 * `says` is their sentence and `terms` where they say it. Whether a vendor counts him among its
 * supported tools is the vendor's to decide and the owner's to weigh.
 */
export interface CodingPlan {
  /** The plan, as its vendor sells it. */
  name: string;
  /** What its vendor says the plan is for, in the vendor's words where they are short enough (read November 2026). */
  says: string;
  /** Where the vendor says it. */
  terms: string;
  /** The models it serves (a plan's endpoint doesn't always list them). */
  models: string[];
  /** The header its endpoint routes a conversation by, where it refuses a call without one (OpenCode Go does: 400 MissingSessionID). */
  session?: string;
  /**
   * What its vendor's own terms let Galahad do with it (read 14 November 2026). `native`: his own coding calls (a
   * quest's engineer, a knight's native runner), which only a plan made for coding agents that call as themselves
   * allows. `tools`: lent through the gateway to a coding tool in a knight's VM or a quest's sandbox ("unattended"),
   * or only to a tool you run yourself with `galahad run` ("interactive"), where the terms say interactive use only.
   */
  allows: { native: boolean; tools: "unattended" | "interactive" };
}

/**
 * Starting points, not hard-coded truth: everything here is overridable with
 * `galahad provider add`. Base URLs were checked against each provider's docs
 * (Nov 2026); Verda's endpoint is account-specific so it must be supplied.
 * A coding plan's key can't always be told from the same vendor's API key by its
 * form (Z.ai's can't; Kimi's and Alibaba's can), so a plan is added as its own preset.
 */
export const PRESETS: ProviderPreset[] = [
  { id: "anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", keyPrefixes: ["sk-ant-"] },
  { id: "deepseek", kind: "openai", baseUrl: "https://api.deepseek.com/v1" },
  { id: "abliteration", kind: "openai", baseUrl: "https://api.abliteration.ai/v1" },
  { id: "orcarouter", kind: "openai", baseUrl: "https://api.orcarouter.ai/v1", keyPrefixes: ["sk-orca-"] },
  { id: "openrouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", keyPrefixes: ["sk-or-"] },
  { id: "moonshot", kind: "openai", baseUrl: "https://api.moonshot.ai/v1" },
  { id: "zai", kind: "openai", baseUrl: "https://api.z.ai/api/paas/v4" },
  {
    id: "zai-coding",
    kind: "openai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    plan: {
      name: "GLM Coding Plan",
      says: 'Z.ai: not "for general-purpose API access or any scenarios outside such tools, including but not limited to directly invoking model APIs from your own applications, bots": only inside the coding tools it names (OpenCode, Claude Code, Codex and Hermes among them).',
      terms: "https://docs.z.ai/legal-agreement/subscription-terms",
      models: ["glm-5.3", "glm-5.3-flash"],
      allows: { native: false, tools: "unattended" },
    },
    note: "Z.ai's GLM Coding Plan, with the plan's own key (Z.ai keeps plan keys apart from its API keys; the ordinary API is the zai preset). In mainland China: --base-url https://open.bigmodel.cn/api/coding/paas/v4.",
  },
  {
    id: "kimi-coding",
    kind: "openai",
    baseUrl: "https://api.kimi.ai/coding/v1",
    keyPrefixes: ["sk-kimi-"],
    plan: {
      name: "Kimi Code",
      says: 'Kimi: "Kimi Code subscriptions are for interactive use only" (scripted batch runs are named as beyond normal use), and "Don\'t spoof or alter client identity information".',
      terms: "https://www.kimi.com/code/docs/en/kimi-code/community-guidelines.html",
      models: ["k3.1-pro", "k3.1-pro-highspeed", "k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"],
      allows: { native: false, tools: "interactive" },
    },
    note: "Moonshot's Kimi Code membership (Plus and above), with a key from the Kimi Code console (the pay-as-you-go platform is the moonshot preset; their keys don't work on each other). K3.1 Pro answers only with its thinking on. In mainland China: --base-url https://api.kimi.com/coding/v1.",
  },
  {
    id: "alibaba-coding",
    kind: "openai",
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    // (Its sk-sp- key form is shared since November 2026 with Alibaba's Token Plan and Tencent's Coding Plan, so a pasted
    // key of that form is never guessed to be any one of them.)
    plan: {
      name: "Alibaba Cloud Coding Plan (legacy)",
      says: "Alibaba: \"This plan is for interactive use in programming tools such as Claude Code, Qoder and OpenClaw. Do not use the plan's API key for automated scripts, application backends, or other non-interactive scenarios.\"",
      terms: "https://www.alibabacloud.com/help/en/model-studio/coding-plan",
      models: ["qwen3.7-plus", "qwen3.6-plus", "kimi-k2.5", "glm-5", "MiniMax-M2.5", "qwen3.5-plus"],
      allows: { native: false, tools: "interactive" },
    },
    note: "Alibaba Cloud Model Studio's (Bailian's) Coding Plan, now sold as legacy (Pro only); its successor is the alibaba-token preset. Outside mainland China: --base-url https://coding-intl.dashscope.aliyuncs.com/v1.",
  },
  {
    id: "alibaba-token",
    kind: "openai",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    plan: {
      name: "Alibaba Cloud Token Plan (Personal)",
      says: "Alibaba: \"Token Plan is for interactive use only in coding tools and agent tools… and must not be used for automation scripts, custom application backends, or any non-interactive batch call scenarios.\"",
      terms: "https://www.alibabacloud.com/help/en/model-studio/token-plan-permissions-and-usage",
      models: ["qwen4-max", "qwen3.8-max", "qwen3.8-flash", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash", "deepseek-v4-pro", "deepseek-v4.1-flash", "glm-5.3", "glm-5.2", "auto"],
      allows: { native: false, tools: "interactive" },
    },
    note: "Alibaba Cloud Model Studio's Token Plan (Lite $6 to Pro $43 a month, sold from Singapore), with an sk-sp- key of its own. In mainland China: --base-url https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1.",
  },
  {
    id: "opencode-go",
    kind: "openai",
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    plan: {
      name: "OpenCode Go",
      says: 'OpenCode: "OpenCode Go is designed for OpenCode and other coding agents that produce similar types of requests", each identifying itself "with its own user agent".',
      terms: "https://opencode.ai/docs/console/go/",
      models: ["glm-5.3", "kimi-k3.1-pro", "kimi-k3", "deepseek-v4-pro", "qwen3.8-max", "qwen4-max", "gpt-6-luna"],
      allows: { native: true, tools: "unattended" },
      session: "x-opencode-session",
    },
    note: "OpenCode Go ($10 a month; Go Plus $40), on your OpenCode Console key at its own address (pay-as-you-go has another). Each model has a monthly allowance, a fifth of it in any five hours and half in a week. DeepSeek's models want Global chosen under Regions in the Console.",
  },
  {
    id: "mimo-token",
    kind: "openai",
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    keyPrefixes: ["tp-", "ttp-"],
    plan: {
      name: "Xiaomi MiMo Token Plan",
      says: 'Xiaomi: the quota "is only available for use in programming tools (such as OpenClaw, OpenCode, etc.), and it is prohibited to use it in the form of API calls for request behaviors in obvious non-coding scenarios such as automated scripts and custom application backends."',
      terms: "https://mimo.mi.com/docs/en-US/tokenplan/Token%20Plan/subscription",
      models: ["mimo-v2.6-pro", "mimo-v2.6-flash"],
      allows: { native: false, tools: "unattended" },
    },
    note: "Xiaomi MiMo's Token Plan (Lite $6 to Max $100 a month), with a tp- key of its own (ttp- for a team): the pay-as-you-go sk- key doesn't work here. Its address is the one your Token Plan page shows: Europe --base-url https://token-plan-ams.xiaomimimo.com/v1, mainland China https://token-plan-cn.xiaomimimo.com/v1.",
  },
  {
    id: "minimax-mplan",
    kind: "openai",
    baseUrl: "https://api.minimax.io/v1",
    keyPrefixes: ["sk-cp-"],
    plan: {
      name: "MiniMax M Plan",
      says: 'MiniMax: "M Plan is designed for individual, interactive developer use", in AI tools "such as Claude Code, Codex, Cursor, OpenCode, Hermes Agent, and OpenClaw"; "Pay-as-you-go is recommended for production use."',
      terms: "https://platform.minimax.io/docs/m-plan/faq",
      models: ["MiniMax-M3.1-Flash"],
      allows: { native: false, tools: "interactive" },
    },
    note: "MiniMax's M Plan (once its Coding Plan), with an sk-cp- key of its own, apart from the pay-as-you-go one. In mainland China: --base-url https://api.minimax.cn/v1.",
  },
  {
    id: "volcengine-coding",
    kind: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    plan: {
      name: "Volcengine Ark Coding Plan",
      says: "Volcengine: the quota \"仅在 AI 编程工具中生效，不可用于 API 调用\" (works only inside AI coding tools, never for API calls), and use outside them may be treated as abuse, suspending the subscription.",
      terms: "https://docs.volcengine.com/docs/ark/coding-plan-personal-plan-overview?lang=zh",
      models: ["ark-code-latest", "doubao-seed-2.1-pro", "doubao-seed-2.1-lite", "glm-5.3", "deepseek-v4-pro", "deepseek-v4.1-flash", "kimi-k3.1-pro"],
      allows: { native: false, tools: "unattended" },
    },
    note: "ByteDance's Volcengine Ark Coding Plan (mainland China), on your ordinary Ark key: it is the plan only at this address (…/api/v3 bills the same key as ordinary use).",
  },
  {
    id: "byteplus-coding",
    kind: "openai",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v3",
    plan: {
      name: "BytePlus ModelArk Coding Plan",
      says: 'BytePlus: "Not available for API calls." "Using the Coding Plan–provided Base URL and API key outside AI coding tools may be identified as abuse or a policy violation".',
      terms: "https://docs.byteplus.com/en/docs/modelark/coding-plan-personal-plan-overview",
      models: ["ark-code-latest", "dola-seed-2.0-pro", "dola-seed-2.0-code", "dola-seed-2.0-lite", "glm-5.2", "deepseek-v4-pro", "deepseek-v4.1-flash"],
      allows: { native: false, tools: "unattended" },
    },
    note: "BytePlus ModelArk's Coding Plan (ByteDance's, outside China), on your ordinary ModelArk key: it is the plan only at this address.",
  },
  {
    id: "stepfun-plan",
    kind: "openai",
    baseUrl: "https://api.stepfun.ai/step_plan/v1",
    plan: {
      name: "StepFun Step Plan",
      says: 'StepFun: "you may not access, invoke, or use the subscribed paid services through unofficial, unauthorized, or unspecified tools"; the tools it names include Claude Code, Codex CLI, OpenCode, Hermes Agent and OpenClaw.',
      terms: "https://platform.stepfun.ai/docs/en/step-plan/paid-service-agreement",
      models: ["step-5-preview", "step-3.7-flash", "step-3.5-flash"],
      allows: { native: false, tools: "unattended" },
    },
    note: "StepFun's Step Plan (Flash Mini $6.99 to Flash Max $99 a month, no time windows), on your ordinary Step key: it is the plan only at this address.",
  },
  {
    id: "tencent-coding",
    kind: "openai",
    baseUrl: "https://api.lkeap.cloud.tencent.com/coding/v3",
    plan: {
      name: "Tencent Cloud Coding Plan",
      says: "Tencent: \"严禁 API 调用\" (API calls strictly forbidden): only inside coding tools, never for automated scripts, custom application backends or any non-interactive batch calls.",
      terms: "https://cloud.tencent.com/document/product/1823/130092",
      models: ["tc-code-latest"],
      allows: { native: false, tools: "interactive" },
    },
    note: "Tencent Cloud's Coding Plan (mainland China). Its key's sk-sp- form is the same as Alibaba's plans', so it is never guessed from a key: add it as this preset.",
  },
  {
    id: "qianfan-token",
    kind: "openai",
    baseUrl: "https://qianfan.baidubce.com/v2/tokenplan/personal",
    plan: {
      name: "Baidu Qianfan Token Plan (Personal)",
      says: "Baidu: \"仅限在兼容的AI编程和智能体工具中交互式使用，不可用于自动化脚本或应用后端\" (interactive use only, in compatible AI coding and agent tools; never automated scripts or application backends).",
      terms: "https://cloud.baidu.com/doc/qianfan/s/Dmrabu8b6",
      models: ["qianfan-code-latest", "ernie-5.5-flash-preview", "deepseek-v4-pro", "deepseek-v4.1-flash", "glm-5.3"],
      allows: { native: false, tools: "interactive" },
    },
    note: "Baidu Qianfan's Token Plan (mainland China), with a key of its own.",
  },
  // Flat-rate, but not a coding plan: their terms put no rule on what calls them, so they are providers like any other.
  { id: "nanogpt", kind: "openai", baseUrl: "https://api.nano-gpt.com/api/v1", keyPrefixes: ["sk-nano-"], note: "NanoGPT. Its Pro subscription ($12 a month: 60M input tokens a week on the open models it includes, their output free) is for personal, non-commercial use only, by its terms. Set the key to bill the subscription only, or what it doesn't include is paid as you go." },
  { id: "synthetic", kind: "openai", baseUrl: "https://api.synthetic.new/openai/v1", note: "Synthetic's subscriptions (Go $9, Standard $30, Big $90 a month; weekly limits that refill as you go) put no rule on what calls them. Models are named hf:<org>/<model>, e.g. hf:zai-org/GLM-5.3." },
  { id: "ollama-cloud", kind: "openai", baseUrl: "https://ollama.com/v1", note: "Ollama's cloud models, with your account's API key. Pro ($20 a month) and Max ($100) are prepaid usage at each model's own rates, not a flat allowance." },
  {
    id: "cloudflare-ai",
    kind: "openai",
    baseUrl: "",
    note: "Cloudflare AI Gateway's OpenAI-compatible endpoint: --base-url https://gateway.ai.cloudflare.com/v1/<account id>/<gateway id>/compat. The key is the gateway's token; the providers' own keys stay stored in Cloudflare. Models are named <provider>/<model>, e.g. deepseek/deepseek-chat.",
  },
  {
    id: "verda",
    kind: "openai",
    baseUrl: "",
    note: "Verda's OpenAI-compatible endpoint is shown in your Verda console; pass it with --base-url",
  },
  { id: "ollama", kind: "openai", baseUrl: "http://127.0.0.1:11434/v1", local: true },
  { id: "llamacpp", kind: "openai", baseUrl: "http://127.0.0.1:8080/v1", local: true },
];

export const preset = (id: string): ProviderPreset | undefined => PRESETS.find((p) => p.id === id);

/** The coding plan a provider is on: one added as a plan's preset. A provider of your own making is yours, and Galahad knows nothing of its terms. */
export const planOf = (id: string): CodingPlan | null => preset(id)?.plan ?? null;

/** Whether a model ref is on a coding plan (a ref that doesn't parse isn't one: whoever reads it says what is wrong with it). */
export function onPlan(ref: string): boolean {
  const slash = ref.indexOf("/");
  return slash > 0 && planOf(ref.slice(0, slash)) !== null;
}

/** Why he has no key to call a provider with: none in the vault, or a coding plan's, which is for coding and nothing else of his. */
export const whyNoKey = (id: string, use: "own" | "coding" = "own"): string => {
  const plan = planOf(id);
  if (!plan) return `provider "${id}" has no key in the vault`;
  if (use === "coding" && !plan.allows.native) {
    return plan.allows.tools === "interactive"
      ? `${id} is a coding plan its vendor's terms allow for interactive use only, in a tool you run yourself (galahad run): never his own calls, nor a knight's unattended work (${plan.terms})`
      : `${id} is a coding plan its vendor's terms allow it only inside the coding tools they name (a knight's OpenCode, Claude Code, Codex or Hermes): never his own calls (${plan.terms})`;
  }
  return `${id} is a coding plan: its key is for coding (his quests, the knights' work and their coding tools), and nothing else he does`;
};

/** Who he says he is when he calls a coding plan himself: his own name, and never another tool's. */
export const SELF = "Galahad (coding agent; https://galahad.bot)";

/** What he sends beside the key when the call is his own: to a coding plan, his name, and which conversation this is where the plan routes by that. */
export function selfHeaders(provider: { id: string }, session?: string): Record<string, string> {
  const plan = planOf(provider.id);
  if (!plan) return {};
  return { "user-agent": SELF, ...(plan.session && session ? { [plan.session]: session } : {}) };
}

/**
 * A conversation's session, for a plan that routes by one: an id made from the model and how the conversation
 * began, so every turn of it carries the same one and another conversation another. It says nothing of either.
 */
export const conversationSession = (model: string, began: string): string => sha256B64u(`galahad/session/v1\u0000${model}\u0000${began}`).slice(0, 32);

/** A VM's session for a tool that sent none of its own through the gateway: from the token it calls with, and not the token. */
export const gatewaySession = (token: string): string => sha256B64u(`galahad/gateway-session/v1\u0000${token}`).slice(0, 32);

/**
 * A subscription's sign-in is not an API key: its vendor keeps it to the vendor's own tool. Pasted
 * where a key goes it is recognised and refused, and it is never sent to an API from here.
 */
export interface SignIn {
  vendor: string;
  /** The tool the sign-in is for. */
  tool: string;
  /** Why it isn't taken as a key, and where it belongs, in a sentence or two. */
  why: string;
}

export const SIGN_INS: { prefix: string; signIn: SignIn }[] = [
  {
    // What `claude setup-token` prints, and what Claude Code keeps after a subscription login.
    prefix: "sk-ant-oat",
    signIn: {
      vendor: "Anthropic",
      tool: "Claude Code",
      why: "This is a Claude subscription's sign-in, not an API key. Anthropic keeps a subscription to its own apps, and a sign-in to its own flow: Galahad doesn't hold it and never sends it to the API. It belongs with Claude Code itself, where that runs. An API key from the Claude Console starts sk-ant-api.",
    },
  },
];

/** What a pasted value is, when it is a subscription's sign-in and not a key. */
export function signIn(value: string): SignIn | null {
  return SIGN_INS.find(({ prefix }) => value.startsWith(prefix))?.signIn ?? null;
}

/** Guess the provider from a pasted key, when the key format is distinctive. */
export function detectProvider(key: string): string | null {
  if (signIn(key)) return null;
  const sorted = PRESETS.flatMap((p) => (p.keyPrefixes ?? []).map((prefix) => ({ id: p.id, prefix }))).sort(
    (a, b) => b.prefix.length - a.prefix.length,
  );
  return sorted.find(({ prefix }) => key.startsWith(prefix))?.id ?? null;
}

export interface ProviderRecord {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  secret?: string;
  label?: string;
}

export interface ResolvedProvider extends ProviderRecord {
  apiKey: string | null;
  local: boolean;
}

const isLocalUrl = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(`${url}/`);

export function providerRecords(store: MindStore): ProviderRecord[] {
  return store.lwwPrefix<ProviderRecord>("provider:").map((entry) => entry.value!);
}

export function providerRecord(store: MindStore, id: string): ProviderRecord | null {
  return store.lww<ProviderRecord>(`provider:${id}`)?.value ?? null;
}

export const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Whether the provider may use its configured key. A key is only ever sent to the
 * origin it was pinned to when you entered it, and only for the provider it was
 * entered for, so repointing a provider (or borrowing another provider's key)
 * cannot carry the key to a host of someone else's choosing.
 */
export function keyUsable(vault: Vault, record: ProviderRecord): boolean {
  if (!record.secret) return false;
  const info = vault.info(record.secret);
  return !!info && info.provider === record.id && !!info.origin && info.origin === originOf(record.baseUrl);
}

/**
 * Provider config plus its key, decrypted in memory on this node only. A coding plan's key is
 * handed over only for `coding` (his own coding work: chat.ts) and for a `tool` (the gateway,
 * lending it to a coding tool). For his `own` calls of any other kind a plan resolves with no
 * key, so nothing else he does can call one, whoever forgets to ask.
 */
export function resolveProvider(store: MindStore, vault: Vault, id: string, use: "own" | "coding" | "tool" = "own"): ResolvedProvider | null {
  const record = providerRecord(store, id);
  if (!record) return null;
  let apiKey: string | null = null;
  // A plan's key: never for anything but coding, and for his own coding calls only where its terms allow them.
  const plan = planOf(id);
  if (keyUsable(vault, record) && (!plan || use === "tool" || (use === "coding" && plan.allows.native))) {
    try {
      apiKey = vault.reveal(record.secret!);
    } catch {
      apiKey = null;
    }
  }
  return { ...record, apiKey, local: isLocalUrl(record.baseUrl) };
}

/**
 * One-time migration: keys entered before origin pinning are pinned to the origin
 * their provider uses *now* (trusted configuration). Idempotent.
 */
export function pinLegacyKeys(store: MindStore, vault: Vault): string[] {
  if (!vault.unlocked()) return [];
  const pinned: string[] = [];
  for (const record of providerRecords(store)) {
    if (!record.secret) continue;
    const info = vault.info(record.secret);
    const origin = originOf(record.baseUrl);
    if (info && !info.origin && info.provider === record.id && origin && vault.pin(record.secret, origin)) pinned.push(record.secret);
  }
  return pinned;
}

export function providerViews(store: MindStore, vault: Vault): ProviderView[] {
  return providerRecords(store).map((p) => ({
    id: p.id,
    kind: p.kind,
    baseUrl: p.baseUrl,
    secret: p.secret ?? null,
    label: p.label ?? null,
    hasKey: keyUsable(vault, p),
  }));
}

/** Hosts whose OpenAI-compatible endpoint takes the key in a header of its own. */
const KEY_HEADERS: Record<string, string> = {
  // Cloudflare AI Gateway: the gateway's token goes in cf-aig-authorization, and no Authorization
  // header at all, so Cloudflare adds the provider key you stored with it (an Authorization
  // header would be forwarded to the provider as its key).
  "https://gateway.ai.cloudflare.com": "cf-aig-authorization",
};

/** The headers that carry a provider's key, by its protocol and host. */
export function keyHeaders(provider: { kind: ProviderKind; baseUrl: string; apiKey: string | null }): Record<string, string> {
  if (!provider.apiKey) return {};
  if (provider.kind === "anthropic") return { "x-api-key": provider.apiKey };
  return { [KEY_HEADERS[originOf(provider.baseUrl) ?? ""] ?? "authorization"]: `Bearer ${provider.apiKey}` };
}

/**
 * A fetch that never follows a redirect. A provider's key is pinned to one origin, and
 * fetch would carry key headers such as x-api-key and cf-aig-authorization (and resend
 * the body) to wherever a Location header points.
 */
export const withoutRedirects = (base: typeof fetch = fetch): typeof fetch =>
  ((input: Parameters<typeof fetch>[0], init?: RequestInit) => base(input, { ...init, redirect: "manual" })) as typeof fetch;

/** Ask a provider which models it serves (OpenAI-style and Anthropic `/v1/models`). */
export async function listModels(provider: ResolvedProvider, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const url = provider.kind === "anthropic" ? `${provider.baseUrl}/v1/models?limit=100` : `${provider.baseUrl}/models`;
  const headers: Record<string, string> = { ...keyHeaders(provider), ...(provider.kind === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}) };
  const response = await fetchImpl(url, { headers, redirect: "manual", signal: AbortSignal.timeout(provider.local ? 1500 : 10_000) });
  if (!response.ok) throw new Error(`${provider.id} /models → ${response.status}`);
  const json = (await response.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).sort();
}
