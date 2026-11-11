import { abs, attribute, ceil, dot, float, fract, fwidth, int, max, min, mix, normalWorld, positionLocal, positionWorld, screenCoordinate, sin, smoothstep, step, uniform, uniformArray, uv, vec3 } from "three/tsl";
import { Color, DoubleSide, MeshBasicNodeMaterial, MeshLambertNodeMaterial, type Node, Vector3 } from "three/webgpu";
import { CUT_ROOF, KERB } from "./hall-cutaway.ts";
import { BAY_INSET, CART, CART_LANE, CELLS, EAST, HALL_AISLE, HALL_DOOR, HALL_RISE, HALL_TEETH, HALL_TOOTH, HALL_WALL, HEAD, LAMP_HEIGHT, LAMP_ROWS, NORTH, OPENINGS, type Opening, SILL, SOUTH, WEST } from "./hall-plan.ts";
import { linear } from "./mesher.ts";
import { occlusionMask } from "./occlusion.ts";
import { wetDarken, wetSheen } from "./wet.ts";

/*
 * The workshop hall's materials, and the few uniforms that drive them.
 *
 * Light indoors is the hall's own, the same on every tier: faces under the roof
 * (marked `lit`) take none of the scene's lights (so the sun's shadow map, or
 * the lack of one, can't turn them black or leave them sunlit under a roof),
 * and are lit instead by what really comes in: the sky through the glazing
 * (the scene's own sky and ground colours, read each frame), the sun (or the
 * moon) wherever its rays pass a skylight, a window or the door (worked out per
 * pixel from the openings in the plan, so its patches lie on the floor and the
 * machines where they should), and the high-bay lamps, in pools, brighter at
 * night. Outdoor faces are lit by the scene as everything else is, and take
 * the rain. Everything else is baked into the geometry, so a frame costs these
 * uniforms and nothing more.
 */

type F = Node<"float">;
type V3 = Node<"vec3">;

/** Status lights, screens and lamps: this many colours, by number (0 is dark: nothing glows). */
export const LAMP_SLOTS = 48;
/** Printed parts whose height is clamped while they print (0 is no part: never clamped). */
export const PART_SLOTS = 40;
/** Belts that run (their travel, metres) and progress bars (0..1), by number. */
export const BELT_SLOTS = 4;
export const BAR_SLOTS = 12;

const RECIPROCAL_PI = 1 / Math.PI;

export class HallUniforms {
  /** How dissolved each wall is (by the shell's `cut` index: [nothing, west, east, north, south]) and the roof. */
  readonly wallValues: number[] = [0, 0, 0, 0, 0];
  readonly walls = uniformArray(this.wallValues, "float");
  readonly roof = uniform(0);
  /** Where the hall's own frame is in the scene (the world's origin floats). */
  readonly shift = uniform(new Vector3());
  /** The sky's light (the scene's hemisphere light: its sky and ground colours times its intensity). */
  readonly sky = uniform(new Color(0.6, 0.62, 0.7));
  readonly ground = uniform(new Color(0.35, 0.36, 0.3));
  /** The sun's (or the moon's) light, the way to it (scene axes), and how hard its shadows are (soft under cloud). */
  readonly sun = uniform(new Color(2, 1.9, 1.8));
  readonly sunDir = uniform(new Vector3(0.3, 0.8, 0.3));
  readonly sunShadow = uniform(1);
  /** The lamps' light indoors (linear colour, strength folded in) and how much of it falls in pools under them. */
  readonly fill = uniform(new Color(0.3, 0.29, 0.27));
  readonly pools = uniform(0.5);
  /** The glass: its colour and how solid it looks. */
  readonly glass = uniform(new Color(0.6, 0.75, 0.85));
  readonly glassOpacity = uniform(0.3);
  /** A clock for the screens (seconds; it stops under reduced motion). */
  readonly time = uniform(0);
  readonly lampColors: Color[] = Array.from({ length: LAMP_SLOTS }, () => new Color(0, 0, 0));
  readonly lamps = uniformArray(this.lampColors, "color");
  /** Per cell (1..4; 0 is everything else): 1 while its resident is there, 0 once it has cleared out. */
  readonly presentValues: number[] = [1, 1, 1, 1, 1];
  readonly present = uniformArray(this.presentValues, "float");
  /** Per printed part: the height (hall frame, metres) its layers have reached; anything above is pressed down onto it. */
  readonly clampValues: number[] = Array.from({ length: PART_SLOTS }, () => 1e4);
  readonly clamps = uniformArray(this.clampValues, "float");
  readonly beltValues: number[] = Array.from({ length: BELT_SLOTS }, () => 0);
  readonly belts = uniformArray(this.beltValues, "float");
  readonly barValues: number[] = Array.from({ length: BAR_SLOTS }, () => 0);
  readonly bars = uniformArray(this.barValues, "float");
}

/** An interleaved-gradient threshold per pixel (the same screen-door pattern as occlusion.ts). */
function threshold(): F {
  const p = screenCoordinate.xy.floor();
  return fract(fract(p.x.mul(0.06711056).add(p.y.mul(0.00583715))).mul(52.9829189)) as unknown as F;
}

const el = (array: { element(i: Node): unknown }, i: F): F => array.element(int(i.add(0.5)) as unknown as Node) as unknown as F;
const elV3 = (array: { element(i: Node): unknown }, i: F): V3 => array.element(int(i.add(0.5)) as unknown as Node) as unknown as V3;

/** The shell's mask: false (discarded) where the cutaway has dissolved it. Mirrors hall-cutaway.ts's cutAt. */
/** The packed per-vertex tags (hall-kit.ts's pack): x its lamp slot, y how lit it is indoors, z its shell part or printed part, w its cell. */
const tag = () => attribute("tag", "vec4");
const tagX = () => tag().x as unknown as F;
const tagZ = () => tag().z as unknown as F;
const tagW = () => tag().w as unknown as F;

function cutawayMask(u: HallUniforms) {
  const cut = tagZ();
  const withRoof = step(CUT_ROOF - 0.5, cut);
  const wall = el(u.walls, cut.sub(withRoof.mul(CUT_ROOF)));
  const local = positionWorld.sub(u.shift);
  // The kerb stays (but what goes with the roof has no kerb).
  const kerb = max(step(KERB, local.y), withRoof);
  const amount = max(wall.mul(kerb), withRoof.mul(u.roof));
  return threshold().greaterThanEqual(amount.mul(0.999)).and(occlusionMask());
}

const lit = () => tag().y as unknown as F;
const albedo = () => attribute("color", "vec3") as unknown as V3;
const lamp = (u: HallUniforms) => elV3(u.lamps, tagX());

/** 1 inside [lo, hi], 0 outside, with soft edges `s` wide (a penumbra). */
function within(v: F, lo: number, hi: number, s = 0.05): F {
  return smoothstep(lo - s, lo + s, v).mul(float(1).sub(smoothstep(hi - s, hi + s, v))) as unknown as F;
}

/** A window's glass, seen at `along` (metres along its wall) and `up` (above the floor): its frame, mullions and transom block the light. */
function pane(o: Opening, along: F, up: F): F {
  const frame = 0.14;
  const panes = Math.max(1, Math.round((o.b - o.a) / 1.5));
  const width = (o.b - o.a) / panes;
  let open = within(along, o.a + frame, o.b - frame).mul(within(up, o.z0 + frame, o.z1 - frame)) as unknown as F;
  if (panes > 1) {
    const g = along.sub(o.a).div(width);
    const bar = abs(fract(g.add(0.5)).sub(0.5)).mul(width);
    open = open.mul(smoothstep(0.03, 0.07, bar)) as unknown as F;
  }
  const transom = o.z0 + (o.z1 - o.z0) * 0.62;
  return open.mul(smoothstep(0.03, 0.07, abs(up.sub(transom)))) as unknown as F;
}

/**
 * How much of the sun reaches a point indoors along `L` (the way to the sun, scene axes): through the
 * skylights (the glazed upright faces of the sawtooth, which face west), the windows and the door.
 * Each opening is a plane the ray crosses; the roof's slopes and the walls stop it everywhere else.
 */
function sunThrough(p: V3, L: V3): F {
  const wx = p.x as unknown as F;
  const wy = (p.z as unknown as F).negate() as unknown as F;
  const h = p.y as unknown as F;
  const lx = L.x as unknown as F;
  const ly = (L.y as unknown as F).max(0.02) as unknown as F;
  const ln = (L.z as unknown as F).negate() as unknown as F;
  // The glass of each upright face, between its truss's chords.
  const glassLo = 9.26;
  const glassHi = 9 + HALL_RISE - 0.22;
  // Skylights: west-facing, at the foot of each tooth's slope. Going west, the ray rises `s` per metre;
  // it leaves by the first glazed face it reaches above the eaves, unless a slope stops it first.
  const west = step(0.01, lx.negate());
  const s = ly.div(lx.negate().max(0.01));
  const u = wx.sub(WEST).div(HALL_TOOTH).clamp(0, HALL_TEETH - 0.001);
  const k = u.floor();
  const d0 = wx.sub(k.mul(HALL_TOOTH).add(WEST));
  const h0 = h.add(d0.mul(s));
  const n = ceil(float(glassLo).sub(h0).div(s.mul(HALL_TOOTH))).max(0);
  const hn = h0.add(n.mul(HALL_TOOTH).mul(s));
  const t = d0.add(n.mul(HALL_TOOTH)).div(lx.negate().max(0.01));
  const yc = wy.add(ln.mul(t));
  const post = abs(fract(yc.sub(SOUTH).div(5).add(0.5)).sub(0.5)).mul(5);
  const sky = west
    .mul(step(n, k))
    .mul(float(1).sub(smoothstep(glassHi - 0.08, glassHi + 0.08, hn)))
    .mul(within(yc, SOUTH + 0.4, NORTH - 0.4, 0.1))
    .mul(smoothstep(0.08, 0.14, post));
  // The long walls' windows (one in each bay) and the end walls' windows and door.
  const long = (toward: F, distance: F) => {
    const tt = distance.div(toward.abs().max(0.01));
    const hx = wx.add(lx.mul(tt));
    const hz = h.add(ly.mul(tt));
    const f = fract(hx.sub(WEST).div(HALL_TOOTH)).mul(HALL_TOOTH) as unknown as F;
    const o: Opening = { a: BAY_INSET, b: HALL_TOOTH - BAY_INSET, z0: SILL, z1: HEAD };
    return pane(o, f, hz as unknown as F).mul(within(hx as unknown as F, WEST + 0.5, EAST - 0.5, 0.02));
  };
  const south = step(0.01, ln.negate()).mul(long(ln, wy.sub(SOUTH + HALL_WALL_HALF)));
  const north = step(0.01, ln).mul(long(ln, float(NORTH - HALL_WALL_HALF).sub(wy)));
  const end = (toward: F, distance: F, openings: readonly Opening[]) => {
    const tt = distance.div(toward.abs().max(0.01));
    const hy = wy.add(ln.mul(tt)) as unknown as F;
    const hz = h.add(ly.mul(tt)) as unknown as F;
    let out = float(0) as unknown as F;
    for (const o of openings) out = max(out, o.z0 < 0.01 ? within(hy, o.a, o.b, 0.04).mul(within(hz, -1, o.z1, 0.04)) : pane(o, hy, hz)) as unknown as F;
    return out;
  };
  const westWall = west.mul(end(lx, wx.sub(WEST + HALL_WALL_HALF), OPENINGS.west));
  const eastWall = step(0.01, lx).mul(end(lx, float(EAST - HALL_WALL_HALF).sub(wx), OPENINGS.east));
  return max(max(sky, max(south, north)), max(westWall, eastWall)).mul(step(0.0, L.y as unknown as F)) as unknown as F;
}

const HALL_WALL_HALF = HALL_WALL / 2;

/** How much the high-bay lamps light a point: a fill everywhere, and pools under each lamp. */
function lampPools(p: V3): F {
  const wx = p.x as unknown as F;
  const wy = (p.z as unknown as F).negate() as unknown as F;
  const dx = fract(wx.sub(WEST).div(HALL_TOOTH)).sub(0.5).mul(HALL_TOOTH);
  const spacing = LAMP_ROWS[1]! - LAMP_ROWS[0]!;
  const row = wy.div(spacing).round().clamp(-1, 1).mul(spacing);
  const dy = wy.sub(row);
  const drop = float(LAMP_HEIGHT).sub(p.y as unknown as F).max(0.5);
  const d2 = dx.mul(dx).add(dy.mul(dy));
  // A reflector lamp (its intensity falls off as cos³ off the vertical) over a floor: cos⁶θ / r², normalised
  // to 1 right under a lamp at the floor.
  const c2 = drop.mul(drop).div(drop.mul(drop).add(d2));
  return c2.mul(c2).mul(c2).mul(float(LAMP_HEIGHT * LAMP_HEIGHT).div(drop.mul(drop))) as unknown as F;
}

export interface Lighting {
  /** Work out the sun's patches through the openings (not on the low tier). */
  sun: boolean;
  /** How much rain darkens and sheens outdoor faces (0: they're always dry). */
  wet: number;
}

/**
 * Irradiance indoors (the same units as the scene's lights, so a Lambert face reflects albedo × this ÷ π):
 * the sky through the glazing (mostly from above), the sun's patches, and the lamps.
 */
function indoorLight(u: HallUniforms, o: Lighting): V3 {
  const n = normalWorld;
  const p = positionWorld.sub(u.shift) as unknown as V3;
  // The sky: through the roof's glazing and the windows, softer than outdoors and mostly from above.
  const up = (n.y as unknown as F).mul(0.5).add(0.5);
  const sky = mix(u.ground, u.sky, up).mul(float(0.46).add(up.mul(0.3)));
  // The lamps: a fill that's stronger on faces that look up, and pools.
  const facing = (n.y as unknown as F).max(0).mul(0.5).add(0.5);
  const lamps = u.fill.mul(facing).mul(float(1).add(lampPools(p).mul(u.pools)));
  let out = sky.add(lamps) as unknown as V3;
  if (o.sun) {
    const L = u.sunDir as unknown as V3;
    const ndl = dot(n, L).max(0);
    // Under cloud the sun is spread out: a little of it everywhere rather than patches.
    const through = mix(float(0.18), sunThrough(p, L), u.sunShadow);
    out = out.add(u.sun.mul(ndl).mul(through)) as unknown as V3;
  } else {
    out = out.add(u.sun.mul(0.12)) as unknown as V3;
  }
  return out;
}

/** The scene's lights on a face: all of them outdoors (rain darkens it), none indoors (indoor light is emissive). */
function colorFactor(o: Lighting): V3 {
  const indoor = step(0.995, lit());
  return mix(o.wet > 0 ? wetDarken(o.wet) : vec3(1), vec3(0), indoor) as unknown as V3;
}

/** Indoor light on indoor faces; the lamps' spill through the door on the forecourt; status lights; the rain's sheen outdoors. */
function emissive(u: HallUniforms, o: Lighting, colour: V3 = albedo()): V3 {
  const indoor = step(0.995, lit());
  const inside = colour.mul(indoorLight(u, o)).mul(RECIPROCAL_PI);
  const spill = colour.mul(u.fill).mul(lit()).mul(0.9);
  let out = mix(spill, inside, indoor).add(lamp(u));
  if (o.wet > 0) out = out.add(wetSheen(o.wet).mul(float(1).sub(indoor)));
  return out as unknown as V3;
}

/** The cladding and the roof: lit as the world is outside and by the hall inside, and dissolving for the cutaway (its shadow stays whole). */
export function shellMaterial(u: HallUniforms, o: Lighting): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial({ vertexColors: true });
  m.maskNode = cutawayMask(u);
  m.colorNode = colorFactor({ ...o, wet: o.wet && 0.6 });
  m.emissiveNode = emissive(u, { ...o, wet: o.wet && 0.6 });
  return m;
}

/** A band `half` metres either side of where `d` is 0, its edges smoothed over a pixel. */
function band(d: F, half: number): F {
  const aa = fwidth(d).max(0.004);
  return float(1).sub(smoothstep(float(half).sub(aa), float(half).add(aa), abs(d))) as unknown as F;
}

/** Hazard stripes (yellow and charcoal, on the diagonal): 1 on the yellow. */
function hazard(x: F, y: F): F {
  return band(fract(x.add(y).div(0.6)).sub(0.25), 0.25) as unknown as F;
}

const rgb = (hex: number) => {
  const [r, g, b] = linear(hex);
  return vec3(r, g, b);
};

/**
 * The floor's paint, at a world point: sealed concrete in panels, the aisle's edge lines, each cell's
 * floor inside a hazard border, the cart's lane (with a zebra where it crosses the aisle) and its docks,
 * and a hazard strip across the threshold.
 */
function floorPaint(wx: F, wy: F): V3 {
  const concrete = rgb(0xd6d1c6);
  // Saw cuts between the slab's panels.
  const jx = abs(fract(wx.sub(WEST).div(HALL_TOOTH).add(0.5)).sub(0.5)).mul(HALL_TOOTH);
  const jy = abs(fract(wy.div(5).add(0.5)).sub(0.5)).mul(5);
  let out = mix(concrete, concrete.mul(0.82), max(band(jx, 0.012), band(jy, 0.012))) as unknown as V3;
  // The aisle: a cooler grey, edged in yellow.
  const aisle = step(abs(wy), HALL_AISLE).mul(step(WEST + 0.3, wx));
  out = mix(out, rgb(0xc9d2c8), aisle.mul(0.85)) as unknown as V3;
  out = mix(out, rgb(0xf0c94c), band(abs(wy).sub(HALL_AISLE), 0.07).mul(step(WEST + 1, wx))) as unknown as V3;
  // The cells.
  for (const c of CELLS) {
    const h = c.size / 2;
    const dx = abs(wx.sub(c.x));
    const dy = abs(wy.sub(c.y));
    const inside = step(dx, h).mul(step(dy, h));
    const edge = max(dx, dy);
    out = mix(out, rgb(0xd9d5e7), inside) as unknown as V3;
    const border = inside.mul(step(h - 0.36, edge));
    out = mix(out, mix(rgb(0x3f434c), rgb(0xf0c94c), hazard(wx, wy)), border) as unknown as V3;
  }
  // The cart's lane: pale blue between white edges, a zebra across the aisle, the docks boxed in white.
  const half = CART.width / 2 + 0.3;
  const [a, b, c] = CART_LANE as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  // (Each leg: the distance across it, or far off beyond its ends.)
  const d1 = max(abs(wx.sub(a.x)), max(wy.sub(a.y + 0.9), float(b.y - half).sub(wy)).max(0).mul(1e3));
  const d2 = max(abs(wy.sub(b.y)), max(wx.sub(b.x + half), float(c.x - 1.1).sub(wx)).max(0).mul(1e3));
  const lane = min(d1, d2);
  out = mix(out, rgb(0xb6cfe6), step(lane, half)) as unknown as V3;
  out = mix(out, rgb(0xf7f5f0), band(lane.sub(half), 0.05)) as unknown as V3;
  const zebra = step(abs(wy), HALL_AISLE - 0.15).mul(step(abs(wx.sub(a.x)), half - 0.1)).mul(step(0.5, fract(wy.div(0.9))));
  out = mix(out, rgb(0xf7f5f0), zebra) as unknown as V3;
  // The threshold.
  const sill = step(wx, WEST + HALL_WALL / 2 + 0.25).mul(step(abs(wy), HALL_DOOR.half));
  out = mix(out, mix(rgb(0x3f434c), rgb(0xf0c94c), hazard(wx, wy)), sill) as unknown as V3;
  return out;
}

/** The floor indoors (painted in its shader, its baked shade kept) and the forecourt outside. */
export function floorMaterial(u: HallUniforms, o: Lighting): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial({ vertexColors: true });
  const p = positionWorld.sub(u.shift);
  const [fr] = linear(0xd6d1c6);
  // The vertex colour carries the baked shade (on the floor's own colour): keep it, under the paint.
  const shade = (albedo().x as unknown as F).div(fr);
  const indoor = step(0.995, lit());
  const paint = floorPaint(p.x as unknown as F, (p.z as unknown as F).negate() as unknown as F).mul(shade) as unknown as V3;
  const colour = mix(albedo(), paint, indoor) as unknown as V3;
  m.colorNode = colorFactor(o);
  m.emissiveNode = emissive(u, o, colour);
  return m;
}

/** Floors, frames and machines that stand still: whatever stands between the camera and Galahad dissolves. */
export function solidMaterial(u: HallUniforms, o: Lighting): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial({ vertexColors: true });
  m.maskNode = occlusionMask();
  m.colorNode = colorFactor(o);
  m.emissiveNode = emissive(u, o);
  return m;
}

/**
 * What moves (the machines' moving parts, the parts they make, the cells' residents), skinned. A vertex
 * tagged with a printed part (`part`) is pressed down to the height its print has reached; one tagged
 * with a cell (`fade`) dissolves while that cell's resident is cleared out.
 */
export function rigMaterial(u: HallUniforms, o: Lighting): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial({ vertexColors: true });
  const clamp = el(u.clamps, tagZ());
  m.positionNode = vec3(positionLocal.x, min(positionLocal.y, clamp), positionLocal.z);
  const present = el(u.present, tagW());
  m.maskNode = occlusionMask().and(threshold().greaterThanEqual(float(1).sub(present).mul(0.999)));
  m.colorNode = colorFactor({ ...o, wet: 0 });
  m.emissiveNode = emissive(u, { ...o, wet: 0 });
  return m;
}

/** Window panes and skylights: they go with their wall or the roof. */
export function glassMaterial(u: HallUniforms): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  m.maskNode = cutawayMask(u);
  m.colorNode = albedo().mul(u.glass);
  m.opacityNode = u.glassOpacity;
  return m;
}

/**
 * Screens and belts, by a `kind` attribute: 0 an oscilloscope (a grid and a live trace), 1 a progress bar
 * (a printer's display), 2 a belt (cleats that travel with it, lit as the room is). `slot` picks the
 * trace's phase, the bar or the belt. A resident's screens fade with it (`fade`).
 */
export function screenMaterial(u: HallUniforms): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  const kind = attribute("kind", "float") as unknown as F;
  const slot = attribute("slot", "float") as unknown as F;
  const p = uv();
  const base = albedo();
  // The scope: two sines beating, on a dim grid.
  const t = u.time.mul(2.2).add(slot.mul(1.7));
  const wave = sin(p.x.mul(float(9).add(slot.mul(2.3))).add(t)).mul(0.24).add(sin(p.x.mul(23).sub(t.mul(1.7))).mul(0.08)).add(0.5);
  const trace = float(1).sub(smoothstep(0.02, 0.06, abs(p.y.sub(wave))));
  const grid = max(step(0.94, fract(p.x.mul(6))), step(0.94, fract(p.y.mul(4)))).mul(0.16);
  const scope = base.mul(grid.add(0.1)).add(base.mul(trace).mul(1.6));
  // The bar: filled from the left as far as the print has got.
  const bar = base.mul(mix(float(0.14), float(1.25), step(p.x, el(u.bars, slot)).mul(step(0.25, p.y)).mul(step(p.y, 0.75))));
  // Belts and mesh: lit by the room (a grey that follows the sky and the lamps); a belt's lighter cleat every so often, travelling.
  const cleat = step(0.86, fract(p.x.sub(el(u.belts, slot))));
  const room = u.sky.mul(0.55).add(u.fill.mul(1.2)).mul(0.62);
  const belt = base.mul(room).mul(mix(float(0.85), float(1.3), cleat));
  m.colorNode = mix(mix(scope, bar, step(0.5, kind)), belt, step(1.5, kind));
  const present = el(u.present, attribute("fade", "float") as unknown as F);
  m.maskNode = occlusionMask().and(threshold().greaterThanEqual(float(1).sub(present).mul(0.999)));
  return m;
}

/**
 * The cells' fence panels: a dark wire mesh you see through (u along the panel in wires, v up it), lit
 * as the room is. Up close each wire is drawn; far off, where they're finer than a pixel, the panel
 * fades to the share of it they cover.
 */
export function fenceMaterial(u: HallUniforms): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false });
  const p = uv();
  const wx = abs(fract(p.x).sub(0.5));
  const wy = abs(fract(p.y.mul(FENCE_MESH_ROWS)).sub(0.5));
  const wire = max(smoothstep(0.36, 0.44, wx), smoothstep(0.36, 0.44, wy));
  const fine = fwidth(p.x).mul(2).clamp(0, 1);
  const room = u.sky.mul(0.55).add(u.fill.mul(1.2)).mul(0.62);
  m.colorNode = albedo().mul(room);
  m.opacityNode = mix(mix(float(0.06), float(0.9), wire), float(0.32), fine);
  m.maskNode = occlusionMask();
  return m;
}

/** The fence's mesh has this many rows of wire over its height. */
const FENCE_MESH_ROWS = 18;
