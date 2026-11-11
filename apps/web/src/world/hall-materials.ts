import { abs, attribute, bool, cameraPosition, float, fract, int, max, min, mix, normalWorld, positionLocal, positionWorld, screenCoordinate, sin, smoothstep, step, uniform, uniformArray, uv, vec2, vec3 } from "three/tsl";
import { Color, DoubleSide, MeshBasicNodeMaterial, MeshLambertNodeMaterial, type Node, Vector4 } from "three/webgpu";
import { KERB, ROOF_FROM, ROOF_GONE, WALL_FROM, WALL_GONE } from "./hall-cutaway.ts";
import { occlusionMask } from "./occlusion.ts";
import { wetDarken, wetSheen } from "./wet.ts";

/*
 * The workshop hall's materials, and the few uniforms that drive them: how open
 * the hall is (the cutaway), its own light (a fill by day, lamps at night, on
 * every face marked `lit`), the colour of each status light and screen, which
 * test cells' residents are there, and where each printed part is and how much
 * of it has been laid down. Everything else is baked into the geometry, so a
 * frame costs these uniforms and nothing more.
 */

type F = Node<"float">;
type V3 = Node<"vec3">;

/** Status lights, screens and lamps: this many colours, by number (0 is dark: nothing glows). */
export const LAMP_SLOTS = 40;
/** Printed parts (each a stack of layers that can be laid down). */
export const PART_SLOTS = 16;
/** Belts that run (their travel, metres) and progress bars (0..1), by number. */
export const BELT_SLOTS = 4;
export const BAR_SLOTS = 12;

export class HallUniforms {
  /** 0 closed .. 1 open: the roof and the walls between the camera and the inside dissolve. */
  readonly open = uniform(0);
  /** The hall's own light on what's indoors (linear colour, its strength folded in). */
  readonly fill = uniform(new Color(0.3, 0.3, 0.3));
  /** How much of the sun and the sky reaches indoor faces: 1 where the sun casts shadows (the roof's shadow does it), less where it doesn't. */
  readonly shade = uniform(1);
  /** The glass: its colour and how solid it looks (pale and thin by day, warm and bright at night). */
  readonly glass = uniform(new Color(0.6, 0.75, 0.85));
  readonly glassOpacity = uniform(0.2);
  /** The belts' and screens' share of the room's light (they aren't lit by the scene). */
  readonly room = uniform(new Color(0.7, 0.7, 0.7));
  /** A clock for the screens (seconds; it stops under reduced motion). */
  readonly time = uniform(0);
  readonly lampColors: Color[] = Array.from({ length: LAMP_SLOTS }, () => new Color(0, 0, 0));
  readonly lamps = uniformArray(this.lampColors, "color");
  /** Per cell (1..4; 0 is everything else): 1 while its resident is there, 0 once it has cleared out. */
  readonly presentValues: number[] = [1, 1, 1, 1, 1];
  readonly present = uniformArray(this.presentValues, "float");
  /** Per printed part: where it is (an offset in the scene) and the height its layers have reached (scene y; below the floor: none). */
  readonly partValues: Vector4[] = Array.from({ length: PART_SLOTS }, () => new Vector4(0, 0, 0, -10));
  readonly parts = uniformArray(this.partValues, "vec4");
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

/** The shell's mask: false (discarded) where the cutaway has dissolved it. Mirrors hall-cutaway.ts. */
function cutawayMask(u: HallUniforms) {
  const cut = attribute("cut", "vec4");
  // The camera in the hall's own frame (the world's origin floats).
  const cam = cameraPosition.sub(positionWorld).add(positionLocal);
  const outside = cut.x.mul(cam.x).add(cut.y.mul(cam.z)).sub(cut.z);
  const wall = smoothstep(WALL_FROM, WALL_GONE, outside).mul(step(KERB, positionLocal.y));
  const roof = smoothstep(ROOF_FROM, ROOF_GONE, cam.y).mul(cut.w);
  return threshold().greaterThanEqual(max(wall, roof).mul(u.open));
}

const lit = () => attribute("lit", "float") as unknown as F;
const albedo = () => attribute("color", "vec3") as unknown as V3;
const lamp = (u: HallUniforms) => u.lamps.element(int(attribute("glow", "float").add(0.5))) as unknown as V3;

/** The scene's light on a face: all of it outdoors, `shade` of it indoors; and rain darkens what's outdoors. */
function colorFactor(u: HallUniforms, wet: number): V3 {
  const indoor = step(0.995, lit());
  return mix(wet > 0 ? wetDarken(wet) : vec3(1), vec3(u.shade), indoor) as unknown as V3;
}

/** The hall's own light (brighter on faces that look up: the lamps hang overhead), the status lights, and the sheen of rain outdoors. */
function emissive(u: HallUniforms, wet: number): V3 {
  const form = normalWorld.y.mul(0.22).add(0.78);
  let out = albedo().mul(u.fill).mul(lit()).mul(form).add(lamp(u));
  if (wet > 0) out = out.add(wetSheen(wet).mul(float(1).sub(step(0.995, lit()))));
  return out as unknown as V3;
}

/** The cladding and the roof: lit as the world is outside and by the hall inside, and dissolving for the cutaway (its shadow stays whole). */
export function shellMaterial(u: HallUniforms): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial({ vertexColors: true });
  m.maskNode = cutawayMask(u);
  m.maskShadowNode = bool(true);
  m.colorNode = colorFactor(u, 0.6);
  m.emissiveNode = emissive(u, 0.6);
  return m;
}

/** Floors, frames and machines. `fade`: parts tagged with a cell (a `fade` attribute) dissolve when that cell's resident clears out. */
export function solidMaterial(u: HallUniforms, options: { fade?: boolean; wet?: boolean } = {}): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial({ vertexColors: true });
  const seen = occlusionMask();
  if (options.fade) {
    const present = u.present.element(int(attribute("fade", "float").add(0.5))) as unknown as F;
    m.maskNode = seen.and(threshold().greaterThanEqual(float(1).sub(present)));
  } else m.maskNode = seen;
  m.colorNode = colorFactor(u, options.wet ? 0.7 : 0);
  m.emissiveNode = emissive(u, options.wet ? 0.7 : 0);
  return m;
}

/**
 * Printed parts: stacks of layers. Each vertex knows its part, the foot of its layer and its part's
 * axis; whatever is above the height the print has reached is pressed down onto it, and layers not
 * yet begun are drawn in to the axis (to nothing), so a part grows layer by layer with a flat top.
 */
export function partsMaterial(u: HallUniforms): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial({ vertexColors: true });
  const part = attribute("part", "vec4");
  const slot = u.parts.element(int(part.x.add(0.5)));
  const begun = step(part.y.add(1e-4), slot.w);
  const xz = mix(vec2(part.z, part.w), positionLocal.xz, begun);
  m.positionNode = vec3(xz.x, min(positionLocal.y, slot.w), xz.y).add(slot.xyz);
  m.maskNode = occlusionMask();
  m.colorNode = vec3(u.shade);
  m.emissiveNode = albedo().mul(u.fill).mul(normalWorld.y.mul(0.22).add(0.78));
  return m;
}

/** Window panes, skylights and machine guards: thin and pale by day, warm with the lamps at night; they go with their wall. */
export function glassMaterial(u: HallUniforms): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  m.maskNode = cutawayMask(u);
  m.colorNode = u.glass.mul(albedo());
  m.opacityNode = u.glassOpacity;
  return m;
}

/**
 * Screens and belts, by a `kind` attribute: 0 an oscilloscope (a grid and a live trace), 1 a progress
 * bar (a printer's display), 2 a belt (cleats that travel with it). `slot` picks the trace's phase,
 * the bar or the belt.
 */
export function screenMaterial(u: HallUniforms): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  const kind = attribute("kind", "float");
  const slot = attribute("slot", "float");
  const p = uv();
  const base = albedo();
  // The scope: two sines beating, a little noise in the phase, on a dim grid.
  const t = u.time.mul(2.2).add(slot.mul(1.7));
  const wave = sin(p.x.mul(float(9).add(slot.mul(2.3))).add(t)).mul(0.24).add(sin(p.x.mul(23).sub(t.mul(1.7))).mul(0.08)).add(0.5);
  const trace = float(1).sub(smoothstep(0.02, 0.06, abs(p.y.sub(wave))));
  const grid = max(step(0.94, fract(p.x.mul(6))), step(0.94, fract(p.y.mul(4)))).mul(0.16);
  const scope = base.mul(grid.add(0.1)).add(base.mul(trace).mul(1.6));
  // The bar: filled from the left as far as the print has got.
  const bar = base.mul(mix(float(0.14), float(1.25), step(p.x, u.bars.element(int(slot.add(0.5)))).mul(step(0.25, p.y)).mul(step(p.y, 0.75))));
  // The belt: lit by the room, a lighter cleat every so often, travelling.
  const cleat = step(0.86, fract(p.x.sub(u.belts.element(int(slot.add(0.5))))));
  const belt = base.mul(u.room).mul(mix(float(0.85), float(1.25), cleat));
  m.colorNode = mix(mix(scope, bar, step(0.5, kind)), belt, step(1.5, kind));
  m.maskNode = occlusionMask();
  return m;
}
