import { attribute, clamp, dot, float, fract, instanceColor, mix, modelWorldMatrix, positionGeometry, positionLocal, positionWorld, referenceAttribute, renderGroup, sin, step, uniform, uniformArray, varying, vec2, vec3, vec4 } from "three/tsl";
import { type Node, Vector4 } from "three/webgpu";
import { air } from "./air.ts";
import { PIVOT_RANGE } from "./flora-mesher.ts";
import { type Drivers, DRIVERS, seasonDrivers } from "./flora-season.ts";
import { originUniform } from "./plots.ts";
import { type SeasonChoice, seasonFor, seasonOf, seasonState } from "./season.ts";

/*
 * The season and the wind on the GPU: the uniforms that everything that grows
 * (vegetation.ts) and the land (land.ts) read, and the shader nodes that use
 * them. Nothing about a plant is rebuilt as the date creeps or the wind turns.
 *
 * The season: each part of a plant's model carries the point it grows from,
 * its place in the queue, which of the year's amounts grows it and which of the
 * year's tints colours it (flora-mesher.ts); the vertex shader scales the part
 * about its point and mixes its two colours, each plant a little ahead of or
 * behind its neighbours. The amounts ease towards the date's (or towards a
 * season chosen to look at), so a change of season is watched, never popped.
 *
 * The wind: gusts cross the land as waves that travel the way the weather's
 * wind blows, at its speed: every blade, reed and crown leans downwind, more as
 * a gust's front passes over it and less behind it, and brightens a little as it
 * bends (the pale undersides of leaves, the sheen of bent grass); the land's
 * own grass shimmers with the same waves, so they're seen crossing a meadow far
 * beyond where its blades are drawn. The fronts are bent by a slow cross-wave
 * and broken by a second, finer one, so they never look ruled.
 */

type F = Node<"float">;
type V3 = Node<"vec3">;

/** The wind's strength on what grows: 0 under reduced motion, about 1 in a light breeze, 2.6 in a gale. */
export const wind = uniform(1).setGroup(renderGroup);

/**
 * The gusts' clocks: how far the broad fronts and the fine ripples have travelled (radians of their waves), and the
 * wind's strength again for the land. In the render's shared group: uploaded once a render, however many meshes read it.
 */
const gusts = uniform(new Vector4(0, 0, 1, 0)).setGroup(renderGroup);

/** A broad front every 26 m or so; a ripple every 5 m. */
const FRONT = 0.24;
const RIPPLE = 1.25;

/** The year's amounts (flora-season.ts), as the shaders read them. */
const tints = uniformArray(new Array<number>(DRIVERS).fill(0), "float").setGroup(renderGroup);
const grows = uniformArray(new Array<number>(DRIVERS).fill(1), "float").setGroup(renderGroup);
const widths = uniformArray(new Array<number>(DRIVERS).fill(1), "float").setGroup(renderGroup);
const fresh = uniform(0).setGroup(renderGroup);
/** The ground's seasonal colours: rgb (as the land's own colours are, squared) and how much. */
const ground = {
  grass: uniform(new Vector4(1, 1, 1, 0)).setGroup(renderGroup),
  heath: uniform(new Vector4(1, 1, 1, 0)).setGroup(renderGroup),
  litter: uniform(new Vector4(1, 1, 1, 0)).setGroup(renderGroup),
  marsh: uniform(new Vector4(1, 1, 1, 0)).setGroup(renderGroup),
};

/** How hard the gust is at a point of the scene's world, 0 (the lull behind a front) to 1 (its front); and the fine ripple on it, −1 to 1. */
function gustAt(world: Node<"vec3"> | Node<"vec4">): { gust: F; ripple: F } {
  // In true world metres along and across the wind (the floating origin moves the scene; the waves must not jump when it does).
  const p = vec2(world.x.add(originUniform.x), world.z.sub(originUniform.y));
  const along = dot(p, air.wind);
  const across = dot(p, vec2(air.wind.y.negate(), air.wind.x));
  const front = sin(along.mul(FRONT).sub(gusts.x).add(sin(across.mul(0.09).add(gusts.x.mul(0.17))).mul(1.4)));
  const g = front.mul(0.5).add(0.5);
  return { gust: g.mul(g) as unknown as F, ripple: sin(along.mul(RIPPLE).sub(gusts.y).add(across.mul(0.6))) as unknown as F };
}

/** The lean of something `bend` metres bendable in the wind at a point: downwind, more in a gust, with a flutter across. */
function leaning(world: Node<"vec4">, bend: F): { offset: V3; gust: F } {
  const { gust, ripple } = gustAt(world);
  const lean = bend.mul(gust.mul(1.5).add(0.3));
  const flutter = bend.mul(ripple).mul(0.4);
  return { offset: vec3(air.wind.x.mul(lean).sub(air.wind.y.mul(flutter)), lean.mul(-0.12), air.wind.y.mul(lean).add(air.wind.x.mul(flutter))) as unknown as V3, gust };
}

export interface PlantLook {
  /** How much it bends in the wind (0: not at all). */
  stiffness: number;
  /** How much it brightens as a gust bends it. */
  shimmer: number;
  /** It floats: it rides the water's waves (a function of its world point, metres up). */
  afloat?: (world: Node<"vec4">) => F;
}

/**
 * A plant material's position and colour: each part scaled about its own point by the season's amount for it, the
 * whole leaning downwind in the gusts (more the higher up it is), and its colour its summer one mixed towards its other
 * by the season's tint for it. `colour` is the vertex's colour (linear), the same across a face (so faces stay flat);
 * `shimmer` how much brighter the wind makes it now.
 */
export function plantNodes(look: PlantLook): { position: V3; colour: V3; shimmer: F; through: F } {
  const tone = attribute("tone", "vec4");
  const season = attribute("season", "vec4");
  // Each plant a little ahead of or behind its neighbours (its instance's own tint is its seed).
  const seed = fract(instanceColor.y.mul(61.7));
  const key = fract(season.w.add(seed));
  const code = tone.w.mul(255).add(0.5).floor();
  const grow = code.div(16).floor();
  const tint = code.sub(grow.mul(16));

  const width = widths.element(grow.toInt()) as unknown as F;
  const amount = grows.element(grow.toInt()) as unknown as F;
  const t = clamp(amount.sub(key.mul(float(1).sub(width))).div(width), 0, 1);
  // (flora-season.ts' partScale, exactly.)
  const size = t.mul(float(2).sub(t)).mul(float(1).sub(float(1).sub(width).mul(0.5).mul(float(1).sub(amount))));
  const pivot = season.xyz.mul(PIVOT_RANGE);
  const model = pivot.add(positionGeometry.sub(pivot).mul(size));
  const placed = (referenceAttribute("instanceMatrix", "mat4") as unknown as Node<"mat4">).mul(vec4(model, 1)).xyz;
  let position = placed as unknown as V3;
  let shimmer = float(0) as unknown as F;
  if (look.afloat) position = placed.add(vec3(0, look.afloat(modelWorldMatrix.mul(vec4(placed, 1))), 0)) as unknown as V3;
  else if (look.stiffness > 0) {
    // It bends from its foot: more the higher up (by its own height).
    const { offset, gust } = leaning(modelWorldMatrix.mul(vec4(placed, 1)), model.y.mul(model.y).mul(look.stiffness).mul(wind) as unknown as F);
    position = placed.add(offset) as unknown as V3;
    if (look.shimmer > 0) shimmer = varying(gust.sub(0.3).mul(wind).mul(look.shimmer)) as unknown as F;
  }

  const c = attribute("color", "vec4").rgb;
  const other = tone.rgb;
  const d = clamp((tints.element(tint.toInt()) as unknown as F).mul(1.5).sub(key.mul(0.5)), 0, 1);
  const way = d.mul(d).mul(float(3).sub(d.mul(2)));
  const turned = mix(c.mul(c), other.mul(other), way);
  // New leaves are lighter and yellower (the three kinds of leaf are tints 1 to 3).
  const leaf = step(0.5, tint).mul(step(tint, 3.5));
  const colour = varying(turned.mul(mix(vec3(1), vec3(1.2, 1.14, 0.74), fresh.mul(leaf)))) as unknown as V3;
  // How much of the sky's light comes through it: a turned leaf seen from its shaded side still glows.
  const through = varying(way.mul(leaf)) as unknown as F;
  return { position, colour, shimmer, through };
}

/** Sways a model in the wind as a crown does (the keep's own tree): more at the top, leaning downwind in the gusts. */
export function swaying(stiffness: number) {
  const { offset } = leaning(modelWorldMatrix.mul(vec4(positionLocal, 1)), positionGeometry.y.mul(positionGeometry.y).mul(stiffness).mul(wind) as unknown as F);
  return positionLocal.add(offset);
}

/**
 * The land's colour for the season: `base` is a face's summer colour (linear), `cover` what covers it (grass, heath,
 * a deciduous wood's floor, marsh: 0 to 1 each). Grass pales (keeping each face's own lightness), heath goes mauve in
 * flower and russet after, leaves lie on the wood's floor face by face as they fall, a marsh goes to straw; and the
 * gusts cross its grass as light.
 */
export function groundSeason(base: V3, cover: Node<"vec4">): V3 {
  // A face's own lightness against a meadow's, so its patches and its facets still show under the season's colour.
  const own = clamp(base.y.div(0.35), 0.6, 1.4);
  let c = mix(base, ground.grass.xyz.mul(own), ground.grass.w.mul(cover.x)) as unknown as V3;
  c = mix(c, ground.heath.xyz.mul(own), ground.heath.w.mul(cover.y)) as unknown as V3;
  c = mix(c, ground.marsh.xyz.mul(own), ground.marsh.w.mul(cover.w)) as unknown as V3;
  // Fallen leaves tint the ground under the trees, never floor it: every face a little, some more than others (a
  // number of its own, from its colour), so the wood's floor is mottled with them and the grass still shows through.
  const turn = fract(base.x.mul(917.3).add(base.y.mul(531.7)));
  const lying = ground.litter.w.mul(cover.z).mul(turn.mul(0.7).add(0.3));
  c = mix(c, ground.litter.xyz.mul(fract(turn.mul(7.3)).mul(0.3).add(0.85)), lying.mul(0.6)) as unknown as V3;
  const shimmer = gustAt(positionWorld).gust.sub(0.3).mul(gusts.z).mul(0.09).mul(cover.x);
  return c.mul(shimmer.add(1)) as unknown as V3;
}

// ---------- keeping them to the date and the weather ----------

/** What the shaders show now, easing towards what the season says (until the scene keeps it to the date: the summer the world always had). */
const shown = seasonDrivers(seasonState);
const target = seasonDrivers(seasonState);
let started = false;
let stale = true;
let settling = false;
/** A season chosen to look at (the debug hook), or a point of the year (0 to 1); null: the real date. */
let chosen: SeasonChoice | number | null = null;
let keptMinute = -1;

/**
 * Keeps the world's season (season.ts' `seasonState`) to Denmark's date, or to the one chosen to look at. Asked
 * every frame; it looks at the date once a minute.
 */
export function keepSeason(now: number): void {
  const minute = Math.floor(now / 60_000);
  if (minute === keptMinute) return;
  keptMinute = minute;
  if (typeof chosen === "number") seasonOf(chosen, seasonState);
  else seasonFor(chosen ?? "live", now, seasonState);
  stale = true;
}

/** Looks at a season (or a point of the year, 0 to 1) instead of the real one; "live" or null goes back to the date. */
export function chooseSeason(choice: SeasonChoice | number | null): void {
  chosen = choice === "live" ? null : choice;
  keptMinute = -1;
}

/**
 * `globalThis.__sandboxSeason(name | 0..1 | "live", snap?)` for a tour (the page's `?trace=1`): looks at a season (or
 * a point of the year), eased unless `snap`, and says which it shows.
 */
export function seasonHook(): void {
  (globalThis as { __sandboxSeason?: unknown }).__sandboxSeason = (choice: SeasonChoice | number | null = "live", snap = false) => {
    chooseSeason(choice);
    keepSeason(Date.now());
    if (snap) started = false;
    return { name: seasonState.name, year: seasonState.year, leaf: seasonState.leaf, turn: seasonState.turn, bloom: seasonState.bloom, litter: seasonState.litter };
  };
}

/** Seconds to cover about two thirds of the way to a newly chosen season. */
const EASE_S = 1.6;

function ease(from: Float32Array, to: Float32Array, k: number): number {
  let far = 0;
  for (let i = 0; i < from.length; i++) {
    const d = to[i]! - from[i]!;
    if (Math.abs(d) < 0.002) from[i] = to[i]!;
    else {
      from[i] = from[i]! + d * k;
      far = Math.max(far, Math.abs(d));
    }
  }
  return far;
}

/**
 * A frame of the growth's own clocks: the season's amounts ease towards `seasonState`'s (at once the first time, and
 * under reduced motion), and the gusts travel on at the wind's speed (`speed` m/s; not at all under reduced motion).
 * Returns true while the season's look is still changing (the frame wants drawing).
 */
export function stepGrowth(dt: number, speed: number, motion: boolean): boolean {
  if (motion) {
    // Fronts travel at the wind's own speed; wrapped where their waves are whole, so the floats stay exact for days.
    gusts.value.x = (gusts.value.x + dt * speed * FRONT) % (Math.PI * 200);
    gusts.value.y = (gusts.value.y + dt * (2 + speed * 0.9) * RIPPLE) % (Math.PI * 200);
  }
  gusts.value.z = wind.value;
  if (stale) {
    seasonDrivers(seasonState, target);
    stale = false;
    settling = true;
  }
  if (!settling) return false;
  const k = !started || !motion ? 1 : 1 - Math.exp(-dt / EASE_S);
  started = true;
  let far = Math.max(ease(shown.tint, target.tint, k), ease(shown.grow, target.grow, k));
  // (How the parts take their turns isn't eased: it only changes while every part is there, or none.)
  shown.width.set(target.width);
  for (const g of GROUNDS) far = Math.max(far, ease(shown[g], target[g], k));
  const df = target.fresh - shown.fresh;
  shown.fresh = Math.abs(df) < 0.002 ? target.fresh : shown.fresh + df * k;
  far = Math.max(far, Math.abs(df));
  upload();
  settling = far > 0.002;
  return true;
}

const GROUNDS = ["grass", "heath", "litter", "marsh"] as const;

function upload(): void {
  const t = tints.array as number[];
  const g = grows.array as number[];
  const w = widths.array as number[];
  for (let i = 0; i < DRIVERS; i++) {
    t[i] = shown.tint[i]!;
    g[i] = shown.grow[i]!;
    w[i] = shown.width[i]!;
  }
  fresh.value = shown.fresh;
  // (The land's colours are its vertex colours squared: the season's are laid over them the same way.)
  for (const name of GROUNDS) ground[name].value.set(shown[name][0]! ** 2, shown[name][1]! ** 2, shown[name][2]! ** 2, shown[name][3]!);
}

/** The date's season at once, if nothing has shown one yet (so what's built before the first frame is built for the season it will be drawn in). */
export function primeSeason(now = Date.now()): void {
  if (started) return;
  keepSeason(now);
  stepGrowth(0, 0, false);
}

/** The season's amounts as the shaders have them now (for whoever draws along with them: the leaves in the air). */
export const seasonShown: Readonly<Drivers> = shown;

/** Shows a season (or the date's) at once, with no easing: first sight, and the tests. */
export function showSeason(choice: SeasonChoice | number | null, now = Date.now()): void {
  chooseSeason(choice);
  keepSeason(now);
  started = false;
  stepGrowth(0, 0, false);
}

upload();
