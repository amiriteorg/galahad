import type { Teammate, TeamTask, TeamDelivery } from "./team.ts";

/** Cosmetic identity only. This module stays schema-free for the PWA and world. A knight is drawn as one of the
 * owner's ten drawings (AVATAR_LOOKS; the PWA has the pictures), which a saved profile names by that drawing's colour.
 * The profile's other fields are older than the drawings and still kept: its shape, eyes and headwear name no look,
 * and how lively it is at rest still moves it. */
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

/** A profile as it is saved: exactly its seven fields, each one valid. Anything else is old or malformed. */
export function isAvatarProfile(profile: unknown): profile is AvatarProfile {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
  const p = profile as Record<string, unknown>;
  return Object.keys(p).length === PROFILE_KEYS.length && Object.keys(p).every((key) => PROFILE_KEYS.includes(key))
    && p.v === 1 && memberOf(AVATAR_FORMS, p.form) && hexColor(p.color) && hexColor(p.accent)
    && memberOf(AVATAR_EYES, p.eyes) && memberOf(AVATAR_ACCESSORIES, p.accessory) && memberOf(AVATAR_TEMPERAMENTS, p.temperament);
}

/** Old or malformed snapshots get a safe deterministic appearance. Never pass
 * arbitrary CSS, URLs or extra properties through to an SVG/world renderer. */
export function resolveAvatar(id: string, profile?: unknown): AvatarProfile {
  if (!isAvatarProfile(profile)) return defaultAvatar(id);
  return { v: 1, form: profile.form, color: profile.color.toLowerCase(), accent: profile.accent.toLowerCase(), eyes: profile.eyes, accessory: profile.accessory, temperament: profile.temperament };
}

/** The owner's ten drawings of knights, each by the name it was drawn as, its helm's colour, and its helmet's shape.
 * (Galahad's own drawing, and the Black Knight's he becomes in beast mode, are his alone: not among these.) */
export const AVATAR_LOOKS = [
  { id: "kay", name: "Kay", color: "#f9e9d9", form: "hooded" },
  { id: "gaheris", name: "Gaheris", color: "#9c494f", form: "armored" },
  { id: "percival", name: "Percival", color: "#d5adc7", form: "armored" },
  { id: "palamedes", name: "Palamedes", color: "#945764", form: "armored" },
  { id: "gawain", name: "Gawain", color: "#84845e", form: "round" },
  { id: "tristan", name: "Tristan", color: "#999aab", form: "armored" },
  { id: "lancelot", name: "Lancelot", color: "#93a2c0", form: "armored" },
  { id: "bedivere", name: "Bedivere", color: "#9dac9e", form: "armored" },
  { id: "bors", name: "Bors", color: "#be7153", form: "round" },
  { id: "gareth", name: "Gareth", color: "#fbc866", form: "round" },
] as const satisfies readonly { id: string; name: string; color: string; form: AvatarProfile["form"] }[];
export type AvatarLook = (typeof AVATAR_LOOKS)[number]["id"];

/** The profile saved for a look: the drawing's own colour names it. */
export function lookProfile(look: AvatarLook, temperament: AvatarProfile["temperament"] = "calm"): AvatarProfile {
  const { color, form } = AVATAR_LOOKS.find((each) => each.id === look) ?? AVATAR_LOOKS[0];
  return { v: 1, form, color, accent: matchingAccent(color), eyes: "oval", accessory: "none", temperament };
}

/** How far apart two colours look: RGB weighted by how much red there is ("redmean"), plenty for picking a nearest. */
function apart(a: string, b: string): number {
  const [r1, g1, b1] = [1, 3, 5].map((at) => parseInt(a.slice(at, at + 2), 16));
  const [r2, g2, b2] = [1, 3, 5].map((at) => parseInt(b.slice(at, at + 2), 16));
  const red = (r1! + r2!) / 2;
  return Math.sqrt((2 + red / 256) * (r1! - r2!) ** 2 + 4 * (g1! - g2!) ** 2 + (2 + (255 - red) / 256) * (b1! - b2!) ** 2);
}

/**
 * Which drawing a knight wears. A look chosen for it (its profile has one of the drawings' colours) is the one; else
 * the drawing its first name is (a knight called Gareth is drawn as Gareth); else, for an older profile, the drawing
 * nearest its colour; else one of the ten from its handle alone, the same on every device.
 */
export function avatarLook(id: string, name: string, profile?: unknown): AvatarLook {
  const saved = isAvatarProfile(profile) ? profile.color.toLowerCase() : null;
  const chosen = AVATAR_LOOKS.find((look) => look.color === saved);
  if (chosen) return chosen.id;
  const first = String(name ?? "").trim().toLowerCase().split(/\s+/)[0];
  const named = AVATAR_LOOKS.find((look) => look.id === first);
  if (named) return named.id;
  if (saved) return AVATAR_LOOKS.reduce((best, look) => (apart(look.color, saved) < apart(best.color, saved) ? look : best)).id;
  let seed = 2166136261;
  for (let n = 0; n < id.length; n++) seed = Math.imul(seed ^ id.charCodeAt(n), 16777619) >>> 0;
  return AVATAR_LOOKS[seed % AVATAR_LOOKS.length]!.id;
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
