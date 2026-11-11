import { attribute, float, length, max, mix, positionLocal, select, sin, smoothstep, uniform, vec2, vec3, vertexColor } from "three/tsl";
import { Color, Group, Mesh, MeshBasicNodeMaterial, MeshLambertNodeMaterial, type Node } from "three/webgpu";
import type { Collider } from "./colliders.ts";
import { type BuildDetail, buildStatic, type Halo } from "./field-build.ts";
import { aircraft, restAircraft, stepAircraft } from "./field-circuit.ts";
import { buildGround, type GroundDetail } from "./field-ground.ts";
import { launcher, placeLauncher, stepLauncher } from "./field-launcher.ts";
import { beamMaterial, type MachineDetail, Machines } from "./field-machines.ts";
import { BLOCKHOUSE, ENTRANCE_POSTS, FIELD, FIELD_GATE, FIELD_LEVEL, FIELD_NAMES, FLOODLIGHTS, HANGAR, LAUNCH_SLAB, TOWER } from "./field-plan.ts";
import { quad, restQuad, stepQuad } from "./field-quad.ts";
import { restRover, roverState, stepRover } from "./field-rover.ts";
import { cupSpeed, sockPose, windsock } from "./field-wind.ts";
import { Glows } from "./glows.ts";
import { disposeTree } from "./keep.ts";
import { groundAO } from "./mesher.ts";
import { occlusionMask } from "./occlusion.ts";
import type { Glow, Place, PlaceContext, PlaceFrame } from "./place.ts";
import type { TierName } from "./tiers.ts";
import { ripples, weatherUniforms, wetDarken, wetSheen, only } from "./wet.ts";
import type { Vec3 } from "./coords.ts";

/*
 * The proving ground, on the heights west of the keep: a small airfield and
 * test range. A runway (18/36) with its paint and lights, a taxiway, an apron
 * with a hangar you can see into, a control tower with a glazed cab and a
 * beacon, a windsock and a weather mast that read the real wind, a fuel bowser;
 * a launch pad with a mobile launcher, a flame trench, a blockhouse with a
 * tracking dish; a rover course with real obstacles; a drone corner with gates.
 * Its residents keep it busy when no experiment is running: a light aircraft
 * flying circuits, a rocker-bogie rover on the course, a quadcopter flying its
 * gates and a survey; each makes way when an experiment takes its pad.
 *
 * Drawn in six meshes: the ground (turf, paving, paint), what stands still
 * (solid), lamps and glass (lit), the machines (one skinned mesh), and at night
 * their beams and the field's halos. Its plan is field-plan.ts; how it's built,
 * field-ground.ts, field-build.ts and field-machines.ts; how its machines move,
 * the pure field-circuit.ts, field-rover.ts, field-quad.ts, field-launcher.ts and
 * field-wind.ts. Its group stands at the ground's level, so everything in it
 * is placed as if the ground were at 0.
 */

/** How much of everything each tier gets. */
export const FIELD_DETAIL: Record<TierName, { ground: GroundDetail; build: BuildDetail; machines: MachineDetail; halos: number; animate: number }> = {
  high: {
    ground: { turf: 3.5, tile: 8, fine: true },
    build: { bevel: true, seg: 10, ribs: true, interior: true, props: true, lettering: true, fenceStep: 3, edgeStep: 12 },
    machines: { seg: 10, bevel: true },
    halos: 120,
    animate: 300,
  },
  medium: {
    ground: { turf: 5, tile: 12, fine: true },
    build: { bevel: false, seg: 7, ribs: false, interior: true, props: true, lettering: true, fenceStep: 4.5, edgeStep: 16 },
    machines: { seg: 7, bevel: false },
    halos: 80,
    animate: 220,
  },
  low: {
    ground: { turf: 7, tile: 18, fine: false },
    build: { bevel: false, seg: 6, ribs: false, interior: false, props: false, lettering: false, fenceStep: 6, edgeStep: 24 },
    machines: { seg: 6, bevel: false },
    halos: 40,
    animate: 160,
  },
};

/** Pools of lamplight on the ground at night (scene x, z of the group, radius, strength): floodlights, doors, the gate. */
const POOLS: readonly [number, number, number, number][] = [
  ...FLOODLIGHTS.map((f): [number, number, number, number] => [f.x + Math.cos(f.aim) * 10, -(f.y + Math.sin(f.aim) * 10), 17, 0.55]),
  [HANGAR.x + HANGAR.hx + 3.5, -HANGAR.y, 9, 0.6],
  [HANGAR.x, -HANGAR.y, 7, 0.45],
  [TOWER.x, -(TOWER.y + TOWER.half + 1.2), 5, 0.4],
  [ENTRANCE_POSTS.x - 1.5, -FIELD_GATE.y, 7, 0.5],
  [BLOCKHOUSE.x - 1.5, -(BLOCKHOUSE.y + BLOCKHOUSE.hy + 1.5), 4.5, 0.4],
];

type F = Node<"float">;

/** The lamplight falling on a point of the group (0 outside every pool). */
function pools(): F {
  const p = vec2(positionLocal.x, positionLocal.z);
  let sum: F = float(0) as unknown as F;
  for (const [x, z, r, s] of POOLS) {
    const k = float(1).sub(smoothstep(0, r, length(p.sub(vec2(x, z)))));
    sum = sum.add(k.mul(k).mul(s)) as unknown as F;
  }
  return sum;
}

const WARM = vec3(1, 0.78, 0.5);

export class ProvingGround implements Place {
  readonly group = new Group();
  readonly warmGlows: Glow[] = [];
  readonly coolGlows: Glow[] = [];
  readonly colliders: Collider[] = [];
  readonly movers: { x: number; y: number; r: number }[] = [
    { x: 0, y: 0, r: 0 },
    { x: 0, y: 0, r: 0 },
    { x: 0, y: 0, r: 0 },
    { x: 0, y: 0, r: 0 },
  ];

  private readonly night = uniform(0);
  private readonly lights = uniform(0);
  private readonly beamStrength = uniform(0);
  private readonly materials: (MeshLambertNodeMaterial | MeshBasicNodeMaterial)[] = [];
  private readonly machines: Machines;
  private readonly halos: Glows;
  private readonly range: number;
  private readonly reach: number;

  private readonly plane = aircraft();
  private readonly rover = roverState();
  private readonly drone = quad();
  private readonly launcher = launcher();
  private readonly sock = sockPose();
  private cups = 0;
  private vane = Math.PI;
  private dishAz = -Math.PI / 2;
  private dishEl = 0.5;
  private beacon = 0;
  private barrier = 1;
  private occupied: ReadonlySet<string> = new Set();
  /** Posed for rest (reduced motion) and not changed since. */
  private rested = false;
  private lampLevel = 0;

  constructor(ctx: PlaceContext) {
    const detail = FIELD_DETAIL[ctx.tier.name];
    this.range = detail.animate;
    this.reach = ctx.tier.radius + 80;

    // The ground: turf, paving and paint. Wet paving darkens and mirrors the sky, with puddles; lamplight pools on it at night.
    const ground = new MeshLambertNodeMaterial({ vertexColors: true });
    const gloss = attribute("glow", "float") as unknown as F;
    const wet = weatherUniforms.wetness;
    const puddle = only(wet.greaterThan(0.3), float(0) as unknown as F, () => {
      const p = vec2(positionLocal.x, positionLocal.z);
      const patch = sin(p.x.mul(0.37).add(sin(p.y.mul(0.29)).mul(1.7))).mul(sin(p.y.mul(0.41).add(sin(p.x.mul(0.23)).mul(1.4))));
      return smoothstep(0.3, 0.55, patch.add(wet.mul(0.45)).sub(0.45)).mul(smoothstep(0.35, 0.85, wet)).mul(smoothstep(0.7, 0.95, gloss)) as unknown as F;
    });
    ground.colorNode = vertexColor().mul(wetDarken(0.8)).mul(mix(float(1), float(0.62), puddle));
    ground.emissiveNode = wetSheen(1, () => puddle.add(ripples(0.7).mul(max(puddle, gloss.mul(0.14)))) as unknown as F)
      .mul(gloss.mul(0.8).add(0.2))
      .add(vertexColor().mul(pools()).mul(this.night).mul(WARM));
    const groundMesh = new Mesh(buildGround(detail.ground).build(), ground);
    groundMesh.receiveShadow = ctx.shadows;

    // What stands still: lit inside at night where its glow mask says (the hangar, the tower), and by the pools.
    const solid = new MeshLambertNodeMaterial({ vertexColors: true });
    solid.maskNode = occlusionMask();
    solid.colorNode = vertexColor().mul(wetDarken(0.55));
    const inside = attribute("glow", "float");
    solid.emissiveNode = wetSheen(0.5)
      .add(vertexColor().mul(inside).mul(this.night).mul(WARM).mul(0.95))
      .add(vertexColor().mul(pools()).mul(this.night).mul(WARM).mul(0.6));
    const built = buildStatic(detail.build);
    const solidMesh = new Mesh(built.solid.build({ ao: groundAO(0.6, 1.4, 0.7) }), solid);
    solidMesh.castShadow = ctx.shadows;
    solidMesh.receiveShadow = ctx.shadows;

    // Lamps (lit a little by day, bright at night), lenses (only at night), glass (the sky by day, a lit room at night).
    const lit = new MeshBasicNodeMaterial({ vertexColors: true });
    const kind = attribute("glow", "float");
    const c = vertexColor();
    const lamp = c.mul(float(0.85).add(this.night.mul(1.6)));
    const lens = c.mul(float(0.5).add(this.night.mul(2.4)));
    const glass = mix(c, vec3(1, 0.77, 0.43).mul(1.75), this.night);
    lit.colorNode = select(kind.lessThan(0.25), lamp, select(kind.lessThan(0.75), lens, glass));
    const litMesh = new Mesh(built.light.build(), lit);

    // The machines: their lights glow at night (navigation lights, the beacon's lenses).
    const machine = new MeshLambertNodeMaterial({ vertexColors: true });
    machine.maskNode = occlusionMask();
    machine.colorNode = vertexColor().mul(wetDarken(0.4));
    machine.emissiveNode = wetSheen(0.6).add(vertexColor().mul(attribute("glow", "float")).mul(this.lights).mul(1.7));
    const beams = beamMaterial();
    beams.colorNode = vertexColor().mul(this.beamStrength);
    this.machines = new Machines(detail.machines, machine, beams);
    this.machines.mesh.castShadow = ctx.shadows;
    this.machines.mesh.receiveShadow = ctx.shadows;
    this.machines.beams.visible = false;

    this.materials.push(ground, solid, lit, machine, beams);
    this.group.add(groundMesh, solidMesh, litMesh, this.machines.mesh, this.machines.beams);

    // Halos at night: the runway's lights and the field's lamps, in the group (one draw call, drawn only after dark).
    this.halos = new Glows(this.group, detail.halos);
    const byColor = new Map<number, [number, number, number, number][]>();
    for (const h of built.halos as Halo[]) {
      const list = byColor.get(h.color) ?? [];
      list.push([h.x, h.z, -h.y, h.r]);
      byColor.set(h.color, list);
    }
    let i = 0;
    for (const [color, points] of byColor) this.halos.set(`field${i++}`, points, color);
    // The scene's own glows (larger, softer): the lit cab, the blockhouse's slit. They live in the world's root.
    for (const g of built.warm) this.warmGlows.push([g[0], g[1] + FIELD_LEVEL, g[2], g[3]]);
    for (const g of built.cool) this.coolGlows.push([g[0], g[1] + FIELD_LEVEL, g[2], g[3]]);

    this.group.position.y = FIELD_LEVEL;
    placeLauncher(this.launcher, true);
    this.pose(0);
  }

  setNight(lamps: number): void {
    this.lampLevel = lamps;
    this.night.value = lamps;
    this.halos.setStrength(lamps);
  }

  setOccupied(pads: ReadonlySet<string>): void {
    this.occupied = pads;
    this.rested = false;
  }

  animate(f: PlaceFrame): void {
    // Far away it isn't seen at all; nearer, it's drawn but its machines only move when the camera is close enough to see them.
    const dx = Math.max(0, Math.abs(f.focusX - FIELD.x) - FIELD.hx);
    const dy = Math.max(0, Math.abs(f.focusY - FIELD.y) - FIELD.hy);
    const far = Math.hypot(dx, dy) + f.distance * 0.5;
    this.group.visible = far < this.reach;
    const night = this.lampLevel;
    if (!f.motion) {
      if (this.rested) return;
      restAircraft(this.plane);
      restRover(this.rover);
      restQuad(this.drone);
      placeLauncher(this.launcher, !this.occupied.has("launch"));
      windsock(f.wind, f.windHeading, 0, false, this.sock);
      this.vane = f.windHeading + Math.PI;
      this.barrier = 1;
      this.pose(night);
      this.rested = true;
      return;
    }
    this.rested = false;
    if (!this.group.visible || far > this.range) return;
    const dt = Math.min(0.1, f.dt);
    const flightTaken = this.occupied.has("flight");
    const launchTaken = this.occupied.has("launch");
    const courseTaken = this.occupied.has("course");
    stepAircraft(this.plane, dt, flightTaken, f.windHeading, f.galahadX, f.galahadY);
    stepRover(this.rover, dt, courseTaken, f.galahadX, f.galahadY, f.t);
    stepQuad(this.drone, dt, launchTaken);
    stepLauncher(this.launcher, dt, !launchTaken);
    windsock(f.wind, f.windHeading, f.t, true, this.sock);
    this.cups = (this.cups + cupSpeed(f.wind, 0.2) * dt) % (Math.PI * 2);
    // The vane points into the wind, wandering a little with it.
    const into = f.windHeading + Math.PI + 0.08 * Math.sin(f.t * 0.7) * Math.min(1, f.wind / 6);
    this.vane += wrap(into - this.vane) * (1 - Math.exp(-dt * 2));
    // The dish tracks the quadcopter while it flies, looks at the pad while an experiment has it, and scans otherwise.
    let az: number;
    let el: number;
    if (this.drone.mode === "flying") {
      az = Math.atan2(this.drone.y - (BLOCKHOUSE.y - 0.3), this.drone.x - BLOCKHOUSE.x);
      el = Math.atan2(this.drone.z - BLOCKHOUSE.dish, Math.hypot(this.drone.x - BLOCKHOUSE.x, this.drone.y - BLOCKHOUSE.y));
    } else if (launchTaken) {
      az = Math.atan2(LAUNCH_SLAB.y - BLOCKHOUSE.y, LAUNCH_SLAB.x - BLOCKHOUSE.x);
      el = 0.9;
    } else {
      az = this.dishAz + 0.18 * dt * 3;
      el = 0.45 + 0.15 * Math.sin(f.t * 0.11);
    }
    const turn = wrap(az - this.dishAz);
    this.dishAz += Math.sign(turn) * Math.min(Math.abs(turn), 0.9 * dt);
    this.dishEl += Math.sign(el - this.dishEl) * Math.min(Math.abs(el - this.dishEl), 0.5 * dt);
    // The beacon turns from dusk (twelve times a minute).
    if (night > 0.2) this.beacon = (this.beacon + Math.PI * 0.4 * dt) % (Math.PI * 2);
    // The barrier lifts for Galahad.
    const near = Math.hypot(f.galahadX - ENTRANCE_POSTS.x, f.galahadY - FIELD_GATE.y) < 16;
    this.barrier += Math.sign((near ? 1 : 0) - this.barrier) * Math.min(Math.abs((near ? 1 : 0) - this.barrier), 0.45 * dt);
    this.pose(night);
  }

  /** Every machine where its state says, the movers with them. */
  private pose(night: number): void {
    const m = this.machines;
    const engine = this.plane.power > 0.03;
    m.poseAircraft(this.plane, engine);
    m.poseRover(this.rover);
    m.poseQuad(this.drone);
    m.poseLauncher(this.launcher);
    m.poseWindsock(this.sock);
    m.poseWeather(this.cups, this.vane);
    m.poseDish(this.dishAz, this.dishEl);
    m.poseBeacon(this.beacon);
    m.poseBarrier(ease(this.barrier));
    this.lights.value = night;
    this.beamStrength.value = night * 0.9;
    this.machines.beams.visible = night > 0.05;
    const [a, r, q, l] = this.movers as [Mover, Mover, Mover, Mover];
    a.x = this.plane.x;
    a.y = this.plane.y;
    a.r = this.plane.grounded ? 5.4 : 0;
    r.x = this.rover.pose.x;
    r.y = this.rover.pose.y;
    r.r = 1.7;
    q.x = this.drone.x;
    q.y = this.drone.y;
    q.r = this.drone.z < 1.5 ? 0.9 : 0;
    l.x = this.launcher.x;
    l.y = this.launcher.y;
    l.r = 2.8;
  }

  hover(x: number, y: number, out: Vec3): string | null {
    const label = (lx: number, ly: number, z: number, name: string): string => {
      out[0] = lx;
      out[1] = ly;
      out[2] = z;
      return name;
    };
    const p = this.plane;
    if (Math.hypot(x - p.x, y - p.y) < 4.5 && p.z < 3) return label(p.x, p.y, p.z + 3.6, p.phase === "parked" ? "Light aircraft (tied down)" : `Light aircraft: circuits on runway ${p.direction > 0 ? "36" : "18"}`);
    const r = this.rover.pose;
    if (Math.hypot(x - r.x, y - r.y) < 2) return label(r.x, r.y, 2.4, this.rover.waiting ? "Rover (rocker-bogie): waiting for you to pass" : "Rover (rocker-bogie, after NASA JPL's Open Source Rover)");
    const d = this.drone;
    if (Math.hypot(x - d.x, y - d.y) < 1.6 && d.z < 4) return label(d.x, d.y, d.z + 1.2, d.mode === "charging" ? "Survey quadcopter (charging)" : "Survey quadcopter");
    const l = this.launcher;
    if (Math.hypot(x - l.x, y - l.y) < 3) return label(l.x, l.y, 4, "Mobile launcher");
    for (const n of FIELD_NAMES) if (Math.hypot(x - n.x, y - n.y) < n.r) return label(n.x, n.y, n.z, n.name);
    return null;
  }

  dispose(): void {
    this.halos.dispose();
    disposeTree(this.group);
    for (const m of this.materials) m.dispose();
  }
}

type Mover = { x: number; y: number; r: number };

const ease = (t: number): number => t * t * (3 - 2 * t);

const wrap = (a: number): number => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

void Color;
