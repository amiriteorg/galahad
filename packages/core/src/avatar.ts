import type { Teammate, TeamTask, TeamDelivery } from "./team.ts";

/** Cosmetic identity only. This module stays schema-free for the PWA and world. */
export const AVATAR_FORMS = ["round", "armored", "hooded"] as const;
export const AVATAR_EYES = ["oval", "round", "visor"] as const;
export const AVATAR_ACCESSORIES = ["none", "plume", "ears", "crown"] as const;
export const AVATAR_TEMPERAMENTS = ["calm", "curious", "lively"] as const;
export const AVATAR_EXPRESSIONS = ["idle", "thinking", "working", "waiting", "pleased", "concerned", "resting"] as const;
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

/** Armor and accent pairs that belong together: the editor's presets, and what an unconfigured worker
 * wears. Each accent is a deeper, soft tone of its armor's own hue. An identity's seeded palette is
 * its place in this list, so the order is kept. */
export const AVATAR_PALETTES = [
  { name: "Mint", color: "#b9dfd4", accent: "#6d9f90" },
  { name: "Sand", color: "#e8c8a5", accent: "#b58b69" },
  { name: "Lilac", color: "#c4b2dc", accent: "#9176b4" },
  { name: "Sky", color: "#a8c9db", accent: "#638cb5" },
  { name: "Rose", color: "#e6b1bd", accent: "#b96d8a" },
  { name: "Moss", color: "#bcd0a6", accent: "#7c9f6c" },
  { name: "Honey", color: "#e8ce88", accent: "#ba9254" },
  { name: "Apricot", color: "#f2bb8f", accent: "#d97a60" },
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
  tasks: readonly Pick<TeamTask, "assignee" | "status" | "verified" | "updatedAt">[];
  deliveries: readonly Pick<TeamDelivery, "teammate" | "status" | "updatedAt">[];
}

/** Expressions describe observable work, never inferred mood or private text. */
export function avatarExpression(member: Pick<Teammate, "id" | "enabled">, activity: AvatarActivity, now: number): AvatarExpression {
  const tasks = activity.tasks.filter((task) => task.assignee === member.id);
  const deliveries = activity.deliveries.filter((delivery) => delivery.teammate === member.id);
  if (tasks.some((task) => task.status === "running")) return "working";
  if (deliveries.some((delivery) => delivery.status === "running")) return "thinking";
  if (!member.enabled) return "resting";
  const work = [...tasks, ...deliveries];
  if (work.some((job) => job.status === "queued")) return "waiting";
  const recent = (at: number) => now >= at && now - at < 30_000;
  if (work.some((job) => (job.status === "failed" || job.status === "interrupted") && recent(job.updatedAt))) return "concerned";
  if (tasks.some((task) => task.status === "done" && task.verified && recent(task.updatedAt))) return "pleased";
  return "idle";
}
