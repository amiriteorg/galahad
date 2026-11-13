import { describe, expect, test } from "bun:test";
import { AVATAR_PALETTES, avatarExpression, defaultAvatar, matchingAccent, resolveAvatar, withBodyColor, type AvatarActivity } from "../src/avatar.ts";
import { AvatarProfileSchema } from "../src/team.ts";

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
const luminance = (hex: string) => channels(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const hue = (hex: string) => {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b), spread = max - Math.min(r, g, b);
  return !spread ? 0 : ((max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4) * 60 + 360) % 360;
};
const hueApart = (a: string, b: string) => Math.min(Math.abs(hue(a) - hue(b)), 360 - Math.abs(hue(a) - hue(b)));

describe("knight appearance", () => {
  test("unconfigured identities have stable, distinct, valid defaults across reads", () => {
    const ada = { v: 1, form: "hooded", color: "#e8ce88", accent: "#ba9254", eyes: "oval", accessory: "crown", temperament: "curious" } as const;
    expect(defaultAvatar("ada")).toEqual(ada);
    expect(defaultAvatar("lin")).not.toEqual(ada);
    expect(resolveAvatar("ada")).toEqual(ada);
    expect(resolveAvatar("ada", null)).toEqual(ada);
    const changed = defaultAvatar("ada"); changed.color = "#000000";
    expect(defaultAvatar("ada")).toEqual(ada);
    for (const id of ["ada", "lin", "grace", "worker-with-a-long-name", "owner"]) expect(AvatarProfileSchema.safeParse(defaultAvatar(id)).success).toBe(true);
  });

  test("seeded defaults and presets are one coordinated set: a soft accent in the armor's own hue", () => {
    expect(AVATAR_PALETTES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(AVATAR_PALETTES.map((palette) => palette.name)).size).toBe(AVATAR_PALETTES.length);
    for (const { color, accent } of AVATAR_PALETTES) {
      expect(hueApart(color, accent)).toBeLessThanOrEqual(20);
      // Soft rather than heavy, and still plain to see on the armor.
      expect(luminance(accent)).toBeGreaterThanOrEqual(0.2);
      expect(contrast(color, accent)).toBeGreaterThanOrEqual(1.6);
      expect(contrast(color, accent)).toBeLessThanOrEqual(2.4);
    }
    const seeded = Array.from({ length: 400 }, (_, n) => defaultAvatar(`worker-${n}`));
    for (const { color, accent } of seeded) expect(AVATAR_PALETTES.some((palette) => palette.color === color && palette.accent === accent)).toBe(true);
    expect(new Set(seeded.map((avatar) => avatar.color)).size).toBe(AVATAR_PALETTES.length);
  });

  test("a new armor color brings a matching accent, never the old one from another hue", () => {
    // The pairing that looked wrong: sky-blue armor still wearing the sand palette's brown.
    const sand = { ...defaultAvatar("ada"), color: "#e8c8a5", accent: "#b58b69" };
    const blue = withBodyColor(sand, "#AED4ED");
    expect(blue.color).toBe("#aed4ed");
    expect(hueApart(blue.color, blue.accent)).toBeLessThanOrEqual(20);
    expect({ ...blue, color: sand.color, accent: sand.accent }).toEqual(sand);
    // A preset's armor color brings the preset's own accent.
    expect(withBodyColor(sand, "#a8c9db").accent).toBe("#638cb5");
    // An accent chosen apart from the armor is the owner's choice, and stays.
    const chosen = { ...sand, accent: "#3355aa" };
    expect(withBodyColor(chosen, "#aed4ed").accent).toBe("#3355aa");
    // An accent that had followed the armor keeps following it.
    expect(withBodyColor(blue, "#f0b0c0").accent).toBe(matchingAccent("#f0b0c0"));
    for (const color of ["#aed4ed", "#f2bb8f", "#3d6fd6", "#d94f4f", "#2e7d5b", "#fafafa", "#808080", "#080808", "#000000", "#ffffff"]) {
      const accent = matchingAccent(color);
      expect(accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(matchingAccent(color.toUpperCase())).toBe(accent);
      expect(contrast(color, accent)).toBeGreaterThanOrEqual(1.5);
      const [r, g, b] = channels(color);
      if (Math.max(r, g, b) - Math.min(r, g, b) > 0.1) expect(hueApart(color, accent)).toBeLessThanOrEqual(20);
    }
  });

  test("untrusted snapshots cannot supply arbitrary SVG paint or appearance properties", () => {
    const valid = defaultAvatar("lin");
    expect(resolveAvatar("ada", valid)).toEqual(valid);
    expect(resolveAvatar("ada", { ...valid, color: "#AABBCC" }).color).toBe("#aabbcc");
    for (const value of [undefined, null, "image.svg", [], {}, { ...valid, v: 2 }, { ...valid, form: "orb" },
      { ...valid, eyes: "<script>" }, { ...valid, accessory: "antenna" }, { ...valid, temperament: "angry" },
      { ...valid, color: "url(https://example.invalid/paint)" }, { ...valid, accent: "#fff;opacity:0" },
      { ...valid, src: "https://example.invalid/image.svg" }]) expect(resolveAvatar("ada", value)).toEqual(defaultAvatar("ada"));
    expect(resolveAvatar("ada", valid)).not.toBe(valid);
  });

  test("the browser helper bundles without schemas or server code", async () => {
    const built = await Bun.build({ entrypoints: [new URL("../src/avatar.ts", import.meta.url).pathname], target: "browser" });
    expect(built.success).toBe(true);
    const code = await built.outputs[0]!.text();
    expect(code).not.toContain("invalid_type");
    expect(code).not.toContain("zod");
    expect(code).not.toContain("bun:sqlite");
  });
});

describe("expressions from observable work", () => {
  const now = 100_000;
  const member = { id: "ada", enabled: true };
  const task = (status: AvatarActivity["tasks"][number]["status"], extra: Partial<AvatarActivity["tasks"][number]> = {}) => ({ assignee: "ada", status, verified: false, updatedAt: now, ...extra });
  const delivery = (status: AvatarActivity["deliveries"][number]["status"], extra: Partial<AvatarActivity["deliveries"][number]> = {}) => ({ teammate: "ada", status, updatedAt: now, ...extra });

  test("running work wins, then pause, queue, recent concern, and verified celebration", () => {
    const activity: AvatarActivity = { tasks: [task("done", { verified: true }), task("failed"), task("queued")], deliveries: [] };
    expect(avatarExpression(member, activity, now)).toBe("waiting");
    expect(avatarExpression({ ...member, enabled: false }, activity, now)).toBe("resting");
    expect(avatarExpression({ ...member, enabled: false }, { ...activity, deliveries: [delivery("running")] }, now)).toBe("thinking");
    expect(avatarExpression({ ...member, enabled: false }, { tasks: [task("running")], deliveries: [delivery("running")] }, now)).toBe("working");
    expect(avatarExpression(member, { tasks: [task("done", { verified: true }), task("failed")], deliveries: [] }, now)).toBe("concerned");
    expect(avatarExpression(member, { tasks: [], deliveries: [delivery("interrupted")] }, now)).toBe("concerned");
    expect(avatarExpression(member, { tasks: [task("done", { verified: true })], deliveries: [] }, now)).toBe("pleased");
  });

  test("celebration is verified and lasts thirty seconds; clocks and other identities cannot prolong it", () => {
    const activity = { tasks: [task("done", { verified: true })], deliveries: [] };
    expect(avatarExpression(member, activity, now + 29_999)).toBe("pleased");
    expect(avatarExpression(member, activity, now + 30_000)).toBe("idle");
    expect(avatarExpression(member, activity, now - 1)).toBe("idle");
    expect(avatarExpression(member, { tasks: [task("done")], deliveries: [delivery("done")] }, now)).toBe("idle");
    expect(avatarExpression(member, { tasks: [task("running", { assignee: "lin" })], deliveries: [delivery("running", { teammate: "lin" })] }, now)).toBe("idle");
    expect(avatarExpression(member, { tasks: [task("failed", { updatedAt: now - 30_000 })], deliveries: [] }, now)).toBe("idle");
  });

  test("expression calculation never reads private words or mutates its inputs", () => {
    const privateText = () => { throw new Error("private text must not be inspected"); };
    const worker = Object.freeze({ ...member, get memory() { return privateText(); }, get instructions() { return privateText(); } });
    const job = Object.freeze({ ...task("running"), get goal() { return privateText(); }, get progress() { return privateText(); }, get output() { return privateText(); } });
    expect(avatarExpression(worker, { tasks: Object.freeze([job]), deliveries: Object.freeze([]) }, now)).toBe("working");
  });
});
