import { cameraPosition, cos, float, floor, fract, hash, length, max, renderGroup, select, sin, smoothstep, sqrt, step, uniform, vec2 } from "three/tsl";
import { type Node, Vector2, Vector4 } from "three/webgpu";
import { originUniform } from "../plots.ts";
import { only } from "../wet.ts";
import { CELL, CELLS, type CloudKinds, type CloudTravel, CLOCK_WRAP, CUMULUS_BASE, FIELD, GROW, LEVEL_GAIN, RADIUS_MIN, RADIUS_SPAN, SALT, SHEET_CURVE, SHEET_HEIGHT, SHEET_WAVES, sheetEdge, SQUASH, TOWER_SHARE } from "./clouds.ts";

/*
 * The clouds on the GPU: the same field clouds.ts describes, as uniforms and
 * shader functions that the low clouds' mesh, the sky's dome, the stars and the
 * shadows on the land all read. One place moves it (the sky, with the wind), so
 * a cloud, the patch of sheet above it and the shadows of both travel together.
 *
 * Points along the ground are "absolute": the scene's x and z with the floating
 * origin added back, so the field stays where it is when the origin moves.
 * In the render's shared uniform group: uploaded once a render, not per draw.
 */

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;

const TAU = 2 * Math.PI;

export const cloudField = {
  /** How far the wind has carried the low clouds (x, y: scene x, z) and the sheet (z, w), metres, wrapped to the field. */
  travel: uniform(new Vector4()).setGroup(renderGroup),
  /** The low clouds' level, the sheet's cover, the cirrus, the towers: each 0..1. */
  kinds: uniform(new Vector4()).setGroup(renderGroup),
  /** The thickness above which the sheet is cloud (clouds.ts' sheetEdge of its cover). */
  edge: uniform(1).setGroup(renderGroup),
  /** The slow clock clouds swell and fade on, as a turn (0..2π a day). */
  clock: uniform(0).setGroup(renderGroup),
  /** Where the cloud that shades a point stands from it, per metre of the cloud's height above it: the sun's way along the ground over its steepness (scene x, z). */
  lean: uniform(new Vector2()).setGroup(renderGroup),
};

/** Writes the kinds, the wind's travel and the sun (scene axes: x east, y up, z south) into the uniforms. */
export function setCloudField(kinds: CloudKinds, travel: CloudTravel, sunX: number, sunY: number, sunZ: number): void {
  cloudField.kinds.value.set(kinds.cumulus, kinds.sheet, kinds.cirrus, kinds.towers);
  cloudField.edge.value = sheetEdge(kinds.sheet);
  setCloudTravel(travel);
  const k = 1 / Math.max(0.19, sunY);
  cloudField.lean.value.set(sunX * k, sunZ * k);
}

/** The wind's travel alone (every frame the clouds move). */
export function setCloudTravel(travel: CloudTravel): void {
  cloudField.travel.value.set(travel.x, travel.z, travel.sheetX, travel.sheetZ);
  cloudField.clock.value = (travel.clock / CLOCK_WRAP) * TAU;
}

/** A scene point's absolute place along the ground (x, z): the floating origin added back. */
export const absolute = (x: F, z: F): V2 => vec2(x.add(originUniform.x), z.sub(originUniform.y)) as unknown as V2;

/** The camera's. */
export const cameraAbsolute = (): V2 => absolute(cameraPosition.x as unknown as F, cameraPosition.z as unknown as F);

/** `v` wrapped into 0..period (for any sign: the shader's own remainder isn't). */
const wrap = <T extends F | V2>(v: T, period: number): T => (v as F).sub(floor((v as F).div(period)).mul(period)) as unknown as T;

export interface CellCloud {
  /** The cell's number (a whole number as a float). */
  id: F;
  /** Its cloud's centre in the field (metres), its radius now, the turn of its long axis, how far it has grown (0..1). */
  centre: V2;
  r: F;
  turn: F;
  grown: F;
  /** Its radius full grown at this level, and whether it's one of the few that become thunderheads (0 or 1). */
  full: F;
  tower: F;
}

/** The cloud of a cell (its whole-number coordinates, 0..CELLS − 1) at a level of cumulus: clouds.ts' cloudAt, on the GPU. */
export function cellCloud(cell: V2, level: F): CellCloud {
  const id = cell.x.add(cell.y.mul(CELLS)) as unknown as F;
  const h = (salt: number): F => hash(id.mul(7).add(salt)) as unknown as F;
  const rank = h(SALT.rank);
  const r0 = h(SALT.size).mul(RADIUS_SPAN).add(RADIUS_MIN);
  const room = float(CELL / 2 - 2).sub(r0.mul(1.16));
  const centre = cell.add(0.5).mul(CELL).add(vec2(h(SALT.x), h(SALT.z)).mul(2).sub(1).mul(room)) as unknown as V2;
  const phase = h(SALT.phase);
  const breath = sin(cloudField.clock.mul(floor(phase.mul(50)).add(30)).add(phase.mul(TAU))).mul(0.07).mul(level.mul(4).min(1));
  const grown = smoothstep(rank, rank.add(GROW), level.mul(LEVEL_GAIN).add(breath)) as unknown as F;
  const full = r0.mul(level.mul(0.35).add(0.8)) as unknown as F;
  return { id, centre, r: full.mul(grown) as unknown as F, turn: h(SALT.turn).mul(Math.PI) as unknown as F, grown, full, tower: step(h(SALT.tower), TOWER_SHARE) as unknown as F };
}

/** How much low cloud stands over an absolute point of the land (0..1): clouds.ts' cumulusOver. Nothing when there are none. */
export function cumulusCover(at: V2): F {
  const level = cloudField.kinds.x as unknown as F;
  return only(level.greaterThan(0.004), float(0) as unknown as F, () => {
    const f = wrap(at.sub(cloudField.travel.xy) as unknown as V2, FIELD);
    const c = cellCloud(floor(f.div(CELL)) as unknown as V2, level);
    const d = f.sub(c.centre);
    const co = cos(c.turn);
    const si = sin(c.turn);
    const r = max(c.r, 1);
    const along = d.x.mul(co).add(d.y.mul(si)).div(r);
    const across = d.y.mul(co).sub(d.x.mul(si)).div(r.mul(SQUASH));
    return float(1).sub(smoothstep(0.72, 1.04, length(vec2(along, across)))).mul(step(1, c.r)) as unknown as F;
  });
}

/** The sheet's thickness at a point of its own field, 0..1: clouds.ts' sheetField. */
export function sheetThickness(f: V2): F {
  const { k1, k2, k3, k4, warp1, warp2 } = SHEET_WAVES;
  return sin(f.x.mul(k1).add(sin(f.y.mul(k2)).mul(warp1)))
    .mul(sin(f.y.mul(k3).add(sin(f.x.mul(k4)).mul(warp2))))
    .mul(0.5)
    .add(0.5) as unknown as F;
}

/** How much of the sheet stands over an absolute point of the land (0..1, soft at its rim): clouds.ts' sheetOver. */
export function sheetCover(at: V2): F {
  return only((cloudField.kinds.y as unknown as F).greaterThan(0.004), float(0) as unknown as F, () => {
    const t = sheetThickness(at.sub(cloudField.travel.zw) as unknown as V2);
    return smoothstep(cloudField.edge.sub(0.02), cloudField.edge.add(0.1), t) as unknown as F;
  });
}

/** The shade of the clouds on a scene point of the land (0..1): the low clouds' and the sheet's, each from its own height, whichever is more. */
export function cloudShade(point: V3): F {
  const ground = absolute(point.x as unknown as F, point.z as unknown as F);
  const low = cumulusCover(ground.add(cloudField.lean.mul(float(CUMULUS_BASE).sub(point.y))) as unknown as V2);
  const high = sheetCover(ground.add(cloudField.lean.mul(float(SHEET_HEIGHT).sub(point.y))) as unknown as V2);
  return max(low, high) as unknown as F;
}

/** The sheet's facets: triangles 70 m along a row and 60 m between rows (whole numbers of both across the field, so it repeats with it). */
const FACET_X = FIELD / 60;
const FACET_Z = FIELD / 70;
/** How much each corner of a facet is raised or lowered at random: ragged, never smooth. */
const JITTER = 0.2;

export interface Sheet {
  /** How much cloud is here, 0..1: crisp at the sheet's straight-edged rim. */
  cover: F;
  /** How deep into the cloud this facet is (0 at the rim; about 0.5 in the middle of a thick patch). */
  depth: F;
  /** How the facet tilts towards the sun's side of the sky, about −1..1 (the facets catch the light differently). */
  tilt: F;
}

/**
 * The sheet seen along a scene direction from the camera (`up` its height's
 * sine), as facets: the field is read at the three corners of the triangle the
 * line of sight meets, so its rim is straight-edged and each facet is one flat
 * tone, as everything else in the world. `sunWay` is the sun's way along the
 * ground (scene x, z; unit), for the facets' tilt.
 */
export function sheetSeen(dir: V3, sunWay: V2): Sheet {
  const up = max(dir.y, -0.03);
  // Where the line of sight meets the sheet's shell (clouds.ts' sheetReach): never infinitely far.
  const tan = up.div(sqrt(max(float(1).sub(up.mul(up)), 1e-4)));
  const reach = sqrt(tan.mul(tan).add((2 * SHEET_HEIGHT) / SHEET_CURVE)).sub(tan).mul(SHEET_CURVE);
  const flat = vec2(dir.x, dir.z);
  const at = cameraAbsolute().add(flat.div(max(length(flat), 1e-4)).mul(reach));
  const f = at.sub(cloudField.travel.zw);
  // The triangle here: rows 60 m apart, each shifted half a facet from the last.
  const v = f.y.div(FACET_Z);
  const u = f.x.div(FACET_X).sub(v.mul(0.5));
  const iu = floor(u);
  const iv = floor(v);
  const fu = fract(u);
  const fv = fract(v);
  const upper = step(1, fu.add(fv));
  // A corner's thickness: the field there, raised or lowered by a hash of the corner (the same corner whichever facet asks).
  const corner = (cu: F, cv: F): F => {
    const p = vec2(cu.add(cv.mul(0.5)).mul(FACET_X), cv.mul(FACET_Z)) as unknown as V2;
    const w = wrap(p, FIELD);
    const id = floor(w.x.div(FACET_X / 2).add(0.5)).add(floor(w.y.div(FACET_Z).add(0.5)).mul(120));
    return sheetThickness(p).add(hash(id).sub(0.5).mul(JITTER)) as unknown as F;
  };
  const a = corner(iu.add(upper) as unknown as F, iv.add(upper) as unknown as F);
  const b = corner(iu.add(1) as unknown as F, iv as unknown as F);
  const c = corner(iu as unknown as F, iv.add(1) as unknown as F);
  // Across the facet the thickness is a plane through its corners: the rim is where that plane crosses the edge.
  const wb = select(upper.greaterThan(0.5), float(1).sub(fv), fu);
  const wc = select(upper.greaterThan(0.5), float(1).sub(fu), fv);
  const here = a.add(b.sub(a).mul(wb)).add(c.sub(a).mul(wc));
  const edge = cloudField.edge;
  // The facet's slope, in the field's axes: its one tone comes from this and from its middle.
  const gu = select(upper.greaterThan(0.5), a.sub(c), b.sub(a));
  const gv = select(upper.greaterThan(0.5), a.sub(b), c.sub(a));
  const slope = vec2(gu.div(FACET_X), gv.div(FACET_Z).sub(gu.div(FACET_X * 2)));
  const middle = a.add(b).add(c).div(3);
  return {
    cover: smoothstep(edge, edge.add(0.012), here) as unknown as F,
    depth: max(middle.sub(edge), 0) as unknown as F,
    tilt: slope.x.mul(sunWay.x).add(slope.y.mul(sunWay.y)).mul(-260).clamp(-1, 1) as unknown as F,
  };
}

/** Whether a scene direction from the camera is under the sheet (0..1), softly: for what shines through its gaps (the stars). */
export function sheetVeil(dir: V3): F {
  return only((cloudField.kinds.y as unknown as F).greaterThan(0.004), float(0) as unknown as F, () => {
    const up = max(dir.y, -0.03);
    const tan = up.div(sqrt(max(float(1).sub(up.mul(up)), 1e-4)));
    const reach = sqrt(tan.mul(tan).add((2 * SHEET_HEIGHT) / SHEET_CURVE)).sub(tan).mul(SHEET_CURVE);
    const flat = vec2(dir.x, dir.z);
    const at = cameraAbsolute().add(flat.div(max(length(flat), 1e-4)).mul(reach));
    const t = sheetThickness(at.sub(cloudField.travel.zw) as unknown as V2);
    return smoothstep(cloudField.edge.sub(0.06), cloudField.edge.add(0.04), t) as unknown as F;
  });
}
