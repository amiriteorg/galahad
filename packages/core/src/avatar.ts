import type { Teammate, TeamTask, TeamDelivery } from "./team.ts";

/** Cosmetic identity only. This module stays schema-free for the PWA and world. A knight is drawn as a little
 * creature: its body's shape, its eyes, what it wears on its head, and how lively it is at rest. */
export const AVATAR_FORMS = ["round", "armored", "hooded"] as const;
export const AVATAR_EYES = ["oval", "round", "visor"] as const;
export const AVATAR_ACCESSORIES = ["none", "plume", "ears", "crown"] as const;
export const AVATAR_TEMPERAMENTS = ["calm", "curious", "lively"] as const;
/** What a knight can be seen doing (avatarExpression); its avatar acts each one out. */
export const AVATAR_EXPRESSIONS = ["idle", "thinking", "working", "reading", "browsing", "checking", "waiting", "asking", "pleased", "concerned", "resting"] as const;
export type AvatarExpression = (typeof AVATAR_EXPRESSIONS)[number];

export interface AvatarProfile {
  v: 1;
  form: (typeof AVATAR_FORMS)[number];
  /** Validated six-digit CSS hex colors, never URLs or arbitrary styles. */
  color: string;
  accent: string;
  eyes: (typeof AVATAR_EYES)[number];
  accessory: (typeof AVATAR_ACCESSORIES)[number];
  temperament: (typeof AVATAR_TEMPERAMENTS)[number];
}

/** A knight's colour and its accent (the plume or crown it wears), the accent another tincture so the two stand apart.
 * The editor's presets, and what an unconfigured knight wears. Galahad's own (off-white, navy, oxblood) is none of
 * these. An identity's seeded palette is its place in this list, so the order is kept. */
export const AVATAR_PALETTES = [
  { name: "Gold", color: "#d9a43c", accent: "#2fa36b" },
  { name: "Steel", color: "#b9c8d6", accent: "#2a9d94" },
  { name: "Violet", color: "#9077de", accent: "#dcd6f2" },
  { name: "Copper", color: "#c9713b", accent: "#f2b65f" },
  { name: "Jade", color: "#4fb98a", accent: "#e8c35a" },
  { name: "Rose", color: "#e07a9a", accent: "#a65bd1" },
  { name: "Azure", color: "#4f8fe0", accent: "#f0e8d6" },
  { name: "Crimson", color: "#dd5a52", accent: "#d9d9e0" },
] as const;

/** Stable across devices and renames: seed only from the immutable teammate id.
 * This cosmetic hash is deliberately not used for security or ownership. */
export function defaultAvatar(id: string): AvatarProfile {
  let seed = 2166136261;
  for (let n = 0; n < id.length; n++) seed = Math.imul(seed ^ id.charCodeAt(n), 16777619) >>> 0;
  const next = (count: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % count; };
  const palette = AVATAR_PALETTES[next(AVATAR_PALETTES.length)]!;
  return { v: 1, form: AVATAR_FORMS[next(AVATAR_FORMS.length)]!, color: palette.color, accent: palette.accent,
    eyes: AVATAR_EYES[next(AVATAR_EYES.length)]!, accessory: AVATAR_ACCESSORIES[next(AVATAR_ACCESSORIES.length)]!,
    temperament: AVATAR_TEMPERAMENTS[next(AVATAR_TEMPERAMENTS.length)]! };
}

const PROFILE_KEYS = ["v", "form", "color", "accent", "eyes", "accessory", "temperament"];
const memberOf = <T extends readonly string[]>(values: T, value: unknown): value is T[number] => typeof value === "string" && values.includes(value);
const hexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** The accent that belongs with an armor color (a six-digit hex): a preset's own for a preset's color,
 * otherwise a deeper, quieter tone of the same hue. Dark armor gets a lighter one, so it still shows. */
export function matchingAccent(color: string): string {
  if (!hexColor(color)) throw new TypeError("a six-digit hex color");
  const hex = color.toLowerCase();
  const preset = AVATAR_PALETTES.find((palette) => palette.color === hex);
  if (preset) return preset.accent;
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), spread = max - Math.min(r, g, b);
  const light = max - spread / 2;
  const hue = !spread ? 0 : max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
  const vivid = spread ? spread / (1 - Math.abs(2 * light - 1)) : 0;
  const tone = light < 0.4 ? light + 0.26 : light - 0.22;
  const chroma = (1 - Math.abs(2 * tone - 1)) * Math.min(1, vivid) * 0.72;
  // HSL back to RGB: where a channel sits round the hue circle decides how much of the chroma it carries.
  const channel = (n: number) => { const k = (n + hue + 6) % 6; return tone - chroma / 2 + chroma * (1 - Math.max(0, Math.min(k, 4 - k, 1))); };
  return `#${[5, 3, 1].map((n) => Math.round(channel(n) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** A new armor color. Its accent follows, unless the owner had chosen one apart from the armor's own;
 * a value that isn't a color is left for the boundary to refuse. */
export function withBodyColor(profile: AvatarProfile, color: string): AvatarProfile {
  if (!hexColor(color)) return { ...profile, color };
  const next = color.toLowerCase();
  return { ...profile, color: next, accent: profile.accent === matchingAccent(profile.color) ? matchingAccent(next) : profile.accent };
}

/** Old or malformed snapshots get a safe deterministic appearance. Never pass
 * arbitrary CSS, URLs or extra properties through to an SVG/world renderer. */
export function resolveAvatar(id: string, profile?: unknown): AvatarProfile {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return defaultAvatar(id);
  const p = profile as Record<string, unknown>;
  if (Object.keys(p).length !== PROFILE_KEYS.length || !Object.keys(p).every((key) => PROFILE_KEYS.includes(key))
    || p.v !== 1 || !memberOf(AVATAR_FORMS, p.form) || !hexColor(p.color) || !hexColor(p.accent)
    || !memberOf(AVATAR_EYES, p.eyes) || !memberOf(AVATAR_ACCESSORIES, p.accessory) || !memberOf(AVATAR_TEMPERAMENTS, p.temperament)) return defaultAvatar(id);
  return { v: 1, form: p.form, color: p.color.toLowerCase(), accent: p.accent.toLowerCase(), eyes: p.eyes, accessory: p.accessory, temperament: p.temperament };
}

export interface AvatarActivity {
  /** `progress`, a task's latest line, where the caller has it: without it a running task is simply at work. */
  tasks: readonly (Pick<TeamTask, "assignee" | "status" | "verified" | "updatedAt"> & Partial<Pick<TeamTask, "progress">>)[];
  deliveries: readonly Pick<TeamDelivery, "teammate" | "status" | "updatedAt">[];
}

/**
 * What a running task is at, from the mark that starts the latest line its run reported (the runner's own, one for
 * each step: "Plan · ", "Thinking · ", "Running · ", "Exit N · ", "Gate i/n · " and so on; packages/node/src/team-runtime.ts
 * writes them, and its tests hold the two together). Only the mark is read, never the words after it: a line without
 * one is work, whatever it says.
 */
export function taskStep(progress: string): Extract<AvatarExpression, "thinking" | "working" | "reading" | "browsing" | "checking"> {
  const line = progress.trimStart();
  if (line.startsWith("Plan · ") || line.startsWith("Thinking · ")) return "thinking";
  if (/^Running · desktop(\s|$)/.test(line)) return "browsing";
  if (line.startsWith("Running · ")) return "working";
  if (/^Exit -?\d+ · /.test(line)) return "reading";
  if (/^(Gate \d+\/\d+ · |Gates before the work · |Review · |Submitted for review · )/.test(line) || /^gate[sd]$/.test(line.trimEnd())) return "checking";
  return "working";
}

/** Expressions describe observable work, never inferred mood or private text. */
export function avatarExpression(member: Pick<Teammate, "id" | "enabled">, activity: AvatarActivity, now: number): AvatarExpression {
  const tasks = activity.tasks.filter((task) => task.assignee === member.id);
  const deliveries = activity.deliveries.filter((delivery) => delivery.teammate === member.id);
  const running = tasks.find((task) => task.status === "running");
  if (running) return taskStep(running.progress ?? "");
  if (deliveries.some((delivery) => delivery.status === "running")) return "thinking";
  if (!member.enabled) return "resting";
  const work = [...tasks, ...deliveries];
  if (work.some((job) => job.status === "queued")) return "waiting";
  const recent = (at: number) => now >= at && now - at < 30_000;
  if (work.some((job) => (job.status === "failed" || job.status === "interrupted") && recent(job.updatedAt))) return "concerned";
  if (tasks.some((task) => task.status === "done" && task.verified && recent(task.updatedAt))) return "pleased";
  return "idle";
}
