import { abs, atan, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cos, cross, dFdx, dFdy, dot, float, floor, hash, instanceIndex, length, max, mix, normalize, positionGeometry, sign, sin, smoothstep, step, uniform, varying, vec2, vec3, vec4 } from "three/tsl";
import { Color, IcosahedronGeometry, InstancedMesh, MeshBasicNodeMaterial, type Node, Vector3 } from "three/webgpu";
import { air, airColor, lobes } from "../air.ts";
import { lumpy } from "../mesher.ts";
import { weatherUniforms } from "../wet.ts";
import { cameraAbsolute, cellCloud, cloudField } from "./cloud-field.ts";
import { CELLS, CUMULUS_BASE, FIELD } from "./clouds.ts";
import { dither } from "./dither.ts";

/*
 * The low clouds, as real shapes: every cloud of the field (clouds.ts) is a
 * heap of faceted puffs standing on one flat base, placed, sized and moved in
 * the vertex shader from its instance number (no buffers, no per-frame
 * uploads; one draw call). Fair-weather cumulus has volume: a side lit by the
 * sun, a shaded flat base, and a bright rim where it stands before the sun.
 * Under rain they are dark, ragged scud; in a storm a few grow into
 * thunderheads, a tower of puffs under an anvil that streams downwind, lit from
 * inside by lightning. A low sun colours them from below, the moon lights them
 * at night, and far off they melt into the haze. They stand in the world (not
 * on the sky), so they slide past the far hills as the view moves, and their
 * shadows on the land (atmosphere.ts) are theirs.
 *
 * Drawn before the sky's dome and after everything solid, writing depth: the
 * dome's shader never runs behind them, and the stars and the moon are hidden
 * by them as they should be. None are drawn near the camera (they would be
 * above the view, or in its way from high up) or beyond the far hills' haze.
 */

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;

/**
 * Nearer than this (metres along the ground) a cloud isn't drawn; it has its full size from a little farther.
 * (Nearer ones would stand above the view, whose top is some 11° up: 15° zoomed right in.)
 */
const NEAR = 560;
const NEAR_FULL = 760;
/** It shrinks away from here, and is gone by there (inside the sky's dome and the stars). */
const FAR = 1620;
const FAR_GONE = 1800;
/** A thunderhead stands at least this far off, and its anvil this high on the sky (the tangent of about 9°). */
const TOWER_NEAR = 850;
const TOWER_TOP = 0.158;

export class CloudMesh {
  readonly mesh: InstancedMesh;
  /** The side the light falls on, the side it doesn't, the flat base, and what a low sun adds from below (linear). */
  readonly lit = uniform(new Color(1, 1, 1));
  readonly shade = uniform(new Color(0.7, 0.7, 0.8));
  readonly base = uniform(new Color(0.6, 0.6, 0.7));
  readonly under = uniform(new Color(1, 0.6, 0.45));
  readonly underlight = uniform(0);
  /** The light on the rim of a cloud that stands before the sun (or the moon), and how strong. */
  readonly rim = uniform(new Color(1, 0.95, 0.85));
  readonly rimStrength = uniform(0);
  /** Where the light comes from (scene axes, unit). */
  readonly light = uniform(new Vector3(0, 1, 0));
  /** Where lightning strikes (a unit vector along the ground). */
  readonly flashDir = uniform(new Vector3(1, 0, 0));
  /** How dark and flat the clouds are (scud under rain), 0..1. */
  readonly scud = uniform(0);
  private readonly material: MeshBasicNodeMaterial;

  /** `puffs` to a cloud; `detail` the puffs' facets (an icosahedron subdivided this many times). */
  constructor(puffs: number, detail: number) {
    const m = new MeshBasicNodeMaterial();
    m.fog = false;
    const i = float(instanceIndex) as unknown as F;
    const cloudNo = floor(i.div(puffs));
    const puff = i.sub(cloudNo.mul(puffs));
    const row = floor(cloudNo.div(CELLS));
    const cell = vec2(cloudNo.sub(row.mul(CELLS)), row) as unknown as V2;
    const level = cloudField.kinds.x as unknown as F;
    const c = cellCloud(cell, level);
    const h = (salt: number): F => hash(i.mul(13).add(salt)) as unknown as F;

    // ---- where the cloud is: its place in the field, carried by the wind, the nearest copy of it to the camera ----
    const here = c.centre.add(cloudField.travel.xy).sub(cameraAbsolute()).add(FIELD / 2);
    const rel = here.sub(floor(here.div(FIELD)).mul(FIELD)).sub(FIELD / 2) as unknown as V2;
    const distance = length(rel);
    const shown = smoothstep(NEAR, NEAR_FULL, distance).mul(float(1).sub(smoothstep(FAR, FAR_GONE, distance)));

    // A thunderhead: one of the cells that hold one, as far as the thunder is up, and far enough off to be seen
    // whole (a near one would only show its foot: it stays a heap).
    const tower = c.tower.mul(cloudField.kinds.w).mul(smoothstep(TOWER_NEAR, TOWER_NEAR + 300, distance)) as unknown as F;

    // ---- a heap: puffs along the cloud's long axis, the middle ones bigger and taller ----
    const s = puff.add(0.5).div(puffs).mul(2).sub(1).add(h(1).sub(0.5).mul(1.2 / puffs));
    const edge = abs(s);
    const heapR = c.r.mul(float(0.66).sub(edge.mul(edge.sqrt()).mul(0.34))).mul(h(3).mul(0.4).add(0.8));
    // (Scud is flat and low; a fair-weather heap stands up.)
    const heapTall = float(0.95).add(float(1).sub(edge).mul(h(4)).mul(0.6)).mul(float(1).sub(this.scud.mul(0.45)));
    const heapAt = vec3(s.mul(0.62).mul(c.r), heapR.mul(heapTall).mul(0.32), h(2).sub(0.5).mul(0.6).mul(float(1).sub(edge.mul(0.5))).mul(c.r));
    const heapSize = vec3(heapR, heapR.mul(heapTall), heapR);

    // ---- a thunderhead: an anvil (the first puff) on a stack of puffs, a skirt of cloud round its foot ----
    // It is as tall as the view has room for where it stands: its anvil just under the top of the sky the camera
    // sees, so the far ones are the great ones.
    const stack = Math.max(1, Math.min(3, puffs - 2));
    const body = distance.mul(TOWER_TOP).sub(CUMULUS_BASE).div(0.3 + 0.72 * stack).clamp(22, 78);
    const isAnvil = step(puff, 0.5);
    const isStack = step(0.5, puff).mul(step(puff, stack + 0.5));
    const isSkirt = step(stack + 0.5, puff);
    const k = puff.sub(1);
    const round = h(6).mul(6.283);
    // The anvil streams downwind of the tower.
    const anvilAt = vec3(air.wind.x.mul(body).mul(1.1), body.mul(0.42 + 0.72 * stack - 0.16), air.wind.y.mul(body).mul(1.1));
    const stackAt = vec3(h(7).sub(0.5).mul(body).mul(0.3), body.mul(k.mul(0.72).add(0.42)), h(8).sub(0.5).mul(body).mul(0.3));
    const skirtAt = vec3(cos(round).mul(body).mul(0.9), body.mul(0.16), sin(round).mul(body).mul(0.9));
    const towerAt = anvilAt.mul(isAnvil).add(stackAt.mul(isStack)).add(skirtAt.mul(isSkirt));
    const towerSize = vec3(body.mul(3.4), body.mul(0.3), body.mul(2.3)).mul(isAnvil).add(vec3(body.mul(float(1.05).sub(k.mul(0.12)))).mul(isStack)).add(vec3(body.mul(1.25), body.mul(0.55), body.mul(1.25)).mul(isSkirt));

    // The heap's puffs lie along the cloud's own axis; a thunderhead's stand where they stand.
    const co = cos(c.turn);
    const si = sin(c.turn);
    const heapWorld = vec3(heapAt.x.mul(co).sub(heapAt.z.mul(si)), heapAt.y, heapAt.x.mul(si).add(heapAt.z.mul(co)));
    const at = mix(heapWorld, towerAt, tower);
    const size = mix(heapSize, towerSize, tower);

    // ---- this vertex: the puff's lumpy ball, turned (the anvil along the wind), sized, set on the flat base ----
    const turn = mix(h(5).mul(6.283), atan(air.wind.y, air.wind.x), isAnvil.mul(tower));
    const ct = cos(turn);
    const st = sin(turn);
    const p = positionGeometry;
    const ball = vec3(p.x.mul(ct).sub(p.z.mul(st)), p.y, p.x.mul(st).add(p.z.mul(ct))).mul(size);
    const local = at.add(ball).mul(shown);
    const world = vec3(cameraPosition.x.add(rel.x).add(local.x), max(local.y, 0).add(CUMULUS_BASE), cameraPosition.z.add(rel.y).add(local.z));
    m.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1)));

    // ---- its colour: one flat tone a facet ----
    const pw = varying(world, "cloudWorld") as unknown as V3;
    const top = mix(c.r.mul(1.1), body.mul(0.72 * stack + 0.9), tower).max(1);
    const height = varying(max(local.y, 0).div(top).min(1), "cloudHeight") as unknown as F;
    const towering = varying(tower, "cloudTower") as unknown as F;
    const toEye = cameraPosition.sub(pw);
    const eyeDistance = length(toEye);
    const view = toEye.div(eyeDistance).negate() as unknown as V3;
    // The facet's own normal (from the surface as drawn), turned to face the viewer.
    const face = normalize(cross(dFdx(pw), dFdy(pw)));
    const n = face.mul(sign(dot(face, toEye)).add(0.001)).normalize();
    const towards = dot(n, this.light);
    const isBase = smoothstep(-0.7, -0.93, n.y).mul(float(1).sub(smoothstep(CUMULUS_BASE + 1.5, CUMULUS_BASE + 9, pw.y)));
    // Lit on the light's side, and by the sky on whatever faces up or out (a cloud's flanks are bright all round;
    // only what faces down, and what faces away from a low light, is in shade); a thunderhead is dark below and pale
    // at its anvil.
    const lift = height.mul(0.5).add(0.5);
    const share = smoothstep(-0.55, 0.75, towards.mul(0.72).add(n.y.mul(0.5)).add(0.22)).mul(lift).mul(float(1).sub(this.scud.mul(0.5)));
    const stormy = towering.mul(float(1).sub(smoothstep(0.3, 0.9, height))).mul(0.55);
    // (Its anvil stands above the murk, in what light there is.)
    const anvil = towering.mul(smoothstep(0.72, 0.98, height)).mul(0.55);
    const tone = mix(mix(this.shade, this.lit, share).mul(float(1).sub(stormy)), this.lit.mul(1.35), anvil);
    const based = mix(tone, this.base.mul(float(1).sub(towering.mul(0.35))), isBase);
    // A low sun lights the bases and the lower flanks that face it.
    const below = this.underlight.mul(isBase.mul(0.7).add(float(1).sub(height).mul(max(towards, 0)).mul(0.5)));
    const warmed = mix(based, this.under, below.min(1));
    // Before the light: the facets at the cloud's edge glow (a silver lining), and thin cloud lets a little through.
    const l = lobes(view);
    const forward = max(dot(view, this.light), 0);
    const f2 = forward.mul(forward);
    const f8 = f2.mul(f2).mul(f2).mul(f2);
    const rimmed = warmed.add(this.rim.mul(f8.mul(smoothstep(0.4, 0.92, float(1).sub(abs(dot(n, view))))).mul(this.rimStrength)));
    // Lightning, from inside: most where it strikes, most low in the cloud.
    const struck = weatherUniforms.flash.mul(max(dot(normalize(vec3(view.x, 0, view.z)), this.flashDir), 0).pow(3).mul(0.75).add(0.25)).mul(float(1.15).sub(height.mul(0.5)));
    const flashed = rimmed.add(vec3(0.75, 0.82, 1).mul(struck.mul(1.5)));
    // Far off, into the air's own colour that way (as the far hills are).
    const hazed = mix(flashed, airColor(view, l), smoothstep(950, FAR_GONE + 250, eyeDistance).mul(0.5));
    m.colorNode = hazed.add(dither());

    const geometry = lumpy(new IcosahedronGeometry(1, detail), 7, 0.17);
    this.material = m;
    this.mesh = new InstancedMesh(geometry, m, CELLS * CELLS * puffs);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // After everything solid (only what shows is shaded), before the sky's dome (which they hide).
    this.mesh.renderOrder = 49;
  }

  /** Drawn only while there are any. */
  show(on: boolean): void {
    this.mesh.visible = on;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.material.dispose();
  }
}
