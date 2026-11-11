import type { HeartbeatFinding, Station } from "@galahad/core/world";
import { STATIONS } from "@galahad/core/world";
import { type Group, IcosahedronGeometry, Mesh, MeshLambertMaterial } from "three/webgpu";
import { DRONE_PAD, START_GATE, TIE_DOWN } from "./field-plan.ts";
import { FARM, LINE, printerX, RACKS } from "./hall-plan.ts";
import { BED, BENCH_DOG, BENCH_SEAT, DESK_DOG, DESK_SEAT, DOG_BED, FIRE, JOURNAL, LOG_DOG, LOG_SEAT, TRAIL } from "./hearth-plan.ts";
import { DECK_REST } from "./keep-deck.ts";
import type { Attention, CarePose } from "./knight.ts";
import { type Activity, ACTIVITY_LABEL, type Block, blockPhase, type Intent, intentFor, lifeAt, roundsStop, STILL_LABEL } from "@galahad/core/life";
import type { MicroduckFlock } from "./microducks.ts";
import { standAt, type Target } from "./path.ts";

/*
 * Galahad's life when he isn't working, and how he looks after those in it.
 *
 *   his day      core's life.ts says what (from Denmark's time); this says where he
 *                goes for it, beat by beat, and what he does there: woken by the
 *                dog, his rounds, the trail, his visits, the bench by the lake, the
 *                fire, his journal at his desk, asleep on his bed;
 *   his dog      with him through all of it: out in front on a walk, lying by him
 *                wherever he sits, patted when the work's done, asleep on its
 *                cushion against his bed (its dock: it charges there, and he walks
 *                it there when its battery's low); fetch on the lawns; its mood in
 *                its tail, ears and eye;
 *   his friends  the Microducks gather round when he visits, a stray is led home,
 *                he crouches to look one over; Reachy Mini and he talk at the table;
 *   companions   a walk round the aircraft before it flies, the quadcopter's
 *                battery swapped on its pad, the rover checked at its start gate,
 *                a finished print cleared, the assembly arms looked over;
 *   his heart    the lodestar on his chest beats softly, harder when a heartbeat
 *                runs; what needs you, he goes to and tends, concerned.
 *
 * Work always comes first (life.ts' intentFor). Each frame `step` reads the world
 * and writes his target, pose and attention, the dog's lead and mood, the ducks'
 * gathering and the machines' holds; it allocates nothing (scratch objects only;
 * life.ts is asked once a block). The battery, the ball's flight and the pulse are
 * pure functions, unit-tested; so is the choreography (it needs no GPU).
 */

// ---------- his heart ----------

/** How much brighter the lodestar is now: a soft lub-dub at rest; a strong beat for a few seconds after a heartbeat ran. */
export function lodestarPulse(t: number, sinceBeat: number): number {
  const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
  const rest = (t % 1.25) / 1.25;
  let p = 0.28 * (bump(rest, 0.08, 0.05) + 0.55 * bump(rest, 0.24, 0.05));
  if (sinceBeat >= 0 && sinceBeat < 5) {
    const fast = (sinceBeat % 0.8) / 0.8;
    p += 1.6 * Math.exp(-sinceBeat / 1.6) * (bump(fast, 0.08, 0.06) + 0.6 * bump(fast, 0.26, 0.06));
  }
  return p;
}

// ---------- the dog's battery ----------

/** Below this he walks it to its dock; below CRITICAL it goes on its own (he's busy); it's full again at FULL. */
export const LOW = 0.22;
export const CRITICAL = 0.08;
export const FULL = 0.98;

/** Its charge after `dt` seconds: draining with what it does (more the faster it runs), charging on its dock. */
export function stepCharge(charge: number, dt: number, speed: number, docked: boolean): number {
  if (docked) return Math.min(1, charge + 0.0075 * dt);
  return Math.max(0, charge - (0.00035 + 0.0011 * Math.min(1, speed / 2.5)) * dt);
}

/** Its dock: the cushion tucked against his bed at the hearth (hearth-plan.ts), a post with its charge light beside it. */
export const DOCK = { x: DOG_BED.x, y: DOG_BED.y };
/** Where he stands to see to it: a step to the east of the cushion, facing it. */
export const DOCK_STAND: Target = { x: DOCK.x + 1.25, y: DOCK.y - 0.3, facing: Math.PI };

/** He's worked this long (seconds) before the dog gets its pat when the work's done; and how long that takes. */
export const PAT_AFTER = 30;
const PAT_S = 6;

// ---------- the ball ----------

/** Where a thrown ball is, `u` of the way through its flight (0..1), from `a` (his hand) to `b` (the ground there), with two hops (into `out`, z up). */
export function ballFlight(ax: number, ay: number, az: number, bx: number, by: number, bz: number, u: number, out: [number, number, number]): [number, number, number] {
  const k = Math.max(0, Math.min(1, u));
  // Through the air to 82 % of the way in the first 62 % of the time, then two hops along the rest.
  const reach = k < 0.62 ? (k / 0.62) * 0.82 : 0.82 + ((k - 0.62) / 0.38) * 0.18;
  out[0] = ax + (bx - ax) * reach;
  out[1] = ay + (by - ay) * reach;
  const R = 0.11;
  if (k < 0.62) {
    // An arc from his hand down to the ground, rising 3 m above the straight line at most.
    const s = k / 0.62;
    out[2] = az + (bz + R - az) * s + 4.2 * s * (1 - s);
  } else if (k < 0.85) {
    const s = (k - 0.62) / 0.23;
    out[2] = bz + R + 0.45 * 4 * s * (1 - s);
  } else {
    const s = (k - 0.85) / 0.15;
    out[2] = bz + R + 0.12 * 4 * s * (1 - s);
  }
  return out;
}

export type BallState = "held" | "flying" | "resting" | "carried";

// ---------- where things are for each part of his day ----------

const stand = (x: number, y: number, fx: number, fy: number): Target => ({ x, y, facing: Math.atan2(fy - y, fx - x) });
type Place = Exclude<Station, "field">;
/** Where he stands at each station, worked out once. */
const AT = Object.fromEntries((Object.keys(STATIONS) as Place[]).map((p) => [p, standAt(p)])) as Record<Place, Target>;
/** Spots on the lawns where they play fetch, walked between in turn (open ground south of the keep). */
export const WALK: readonly Target[] = [stand(10, -22, 14, -26), stand(20, -16, 24, -12), stand(4, -26, 0, -30), stand(-12, -22, -16, -26)];
/** The aircraft's walk-round: points round its tie-down, at a wing's length and a little more. */
export const ROUND_PLANE: readonly (readonly [number, number])[] = Array.from({ length: 6 }, (_, i) => {
  const a = TIE_DOWN.heading + Math.PI / 2 + (i * Math.PI * 2) / 6;
  return [TIE_DOWN.x + Math.cos(a) * 7, TIE_DOWN.y + Math.sin(a) * 7] as const;
});
/** The duck lawn south-east of the keep (where they were born), when the flock's middle is too near the keep or a station. */
const LAWN = { x: 11, y: -15, min: 14 };
const PLACES_AT = Object.values(STATIONS);
const PRINT_STAND: Target = { x: printerX(2), y: FARM.belt.y - 1.15, facing: Math.PI / 2 };
const ARMS_STAND: Target = { x: LINE.arms[0]!.x + 1.5, y: LINE.arms[0]!.y + 2.1, facing: -Math.PI / 2 };
const QUAD_STAND: Target = { x: DRONE_PAD.x + 2.4, y: DRONE_PAD.y, facing: Math.PI };
const ROVER_STAND: Target = { x: START_GATE.x + 0.4, y: START_GATE.y + 1.4, facing: -Math.PI / 2 };
const RACK_STAND: Target = { x: RACKS.x, y: RACKS.y - RACKS.hy - 1.4, facing: Math.PI / 2 };

/** What the scene tells care about the world each frame (it keeps one, and fills it in). */
export interface CareFrame {
  now: number;
  dt: number;
  t: number;
  motion: boolean;
  /** The stream says he's at work. */
  working: boolean;
  /** The most serious open heartbeat finding that needs you (lib/world.ts' heartbeatConcern), or null. */
  concern: HeartbeatFinding | null;
  galahad: { x: number; y: number; heading: number; moving: boolean; /** Up on something (the deck, the stairs): the dog can't come to him there. */ raised?: boolean };
  dog: { x: number; y: number; speed: number };
  /** A node's spot at the keep (its label's place), into `out`; false if it isn't shown. */
  nodeSpot(id: string, out: { x: number; y: number }): boolean;
  /** The ground's height. */
  height(x: number, y: number): number;
  /** Wet: where a ball or a dog shouldn't go. */
  wet(x: number, y: number): boolean;
}

/** What care says, each frame. */
export interface CareOut {
  intent: Intent;
  /** Where he goes (when the intent isn't work); `key` changes whenever it does. */
  target: Target;
  key: number;
  pose: CarePose;
  attention: Attention;
  /** Thinking (hand on chin: concerned, or watching), or busy with his hands (reading). */
  thinking: boolean;
  busy: boolean;
  /** At his desk, writing: his hand at the page (the attention point). */
  writing: boolean;
  /** What he's doing, for the selector and his bubble ("" at work: the stream's words are). */
  label: string;
}

/** The dog, as care moves it (dog.ts' lead, mood, charge, mouth). */
export interface CareDog {
  readonly lead: { on: boolean; x: number; y: number; sit: boolean; lie: boolean; run: boolean; faceX: number; faceY: number };
  readonly mood: { wag: number; ears: number; eye: number; joy: number; asleep: number };
  readonly charge: { value: number };
  mouth(out: [number, number, number]): [number, number, number];
}

/** The proving ground, as care reads and holds it (field.ts). */
export interface CareField {
  readonly residents: { plane: { phase: string }; rover: { pose: { x: number; y: number } }; drone: { mode: string } };
  preflight: boolean;
  swapBattery(): void;
}

/** The choreography: what he does, beat by beat. No three.js (CareLook draws the ball and the dock). */
export class Care {
  readonly out: CareOut = {
    intent: "life",
    target: { x: DECK_REST.x, y: DECK_REST.y, z: DECK_REST.z, facing: DECK_REST.facing },
    key: 0,
    pose: { crouch: 0, reach: 0, throw: 0, tilt: 0, sit: 0, lie: 0, asleep: 0 },
    attention: { x: 0, y: 0, z: 0, on: false },
    thinking: false,
    busy: false,
    writing: false,
    label: STILL_LABEL,
  };
  /** The dog's battery (0..1), and whether it's on its dock. */
  charge = 0.75;
  docked = false;
  /** A forced activity (the page's `?life=`, for tours), or null: his day as planned. */
  forced: Activity | null = null;
  /** The ball: where it is, in which state. */
  ball: BallState = "held";
  readonly ballAt: [number, number, number] = [0, 0, 0];

  private block: Block | null = null;
  private activity: Activity = "sleep";
  private intent: Intent = "life";
  /** The beat of its activity, when he arrived at its place (−1: on the way), a step within it and when it began. */
  private beat = 0;
  private arrived = -1;
  private sub = 0;
  private subAt = 0;
  private readonly spot = { x: 0, y: 0 };
  private readonly want: Target = { x: 0, y: 0, facing: 0 };
  private walk = 0;
  private readonly from: [number, number, number] = [0, 0, 0];
  private readonly to: [number, number, number] = [0, 0, 0];
  private throws = 0;
  private flight = 0;
  private stray = -1;
  private chargePatted = false;
  private lastConcern = "";
  /** How long he's been at work (seconds), and what's left of the dog's pat once it's done. */
  private worked = 0;
  private pat = 0;
  /** What the dog feels this frame, beyond its battery and the ball: greeted (0..1), asleep (0..1). */
  private joy = 0;
  private dogSleep = 0;

  constructor(
    private readonly dog: CareDog,
    private readonly flock: MicroduckFlock,
    private readonly field: CareField,
    private readonly talk: (on: number) => void,
  ) {}

  /** The activity now (the plan's, or the forced one). */
  get now(): Activity {
    return this.activity;
  }

  /** He's to go there (the scene replans when `key` changes). */
  private go(target: Target): void {
    const t = this.out.target;
    if (Math.abs(t.x - target.x) < 0.05 && Math.abs(t.y - target.y) < 0.05 && Math.abs(t.facing - target.facing) < 0.05 && t.z === target.z) return;
    t.x = target.x;
    t.y = target.y;
    t.facing = target.facing;
    if (target.z === undefined) delete t.z;
    else t.z = target.z;
    this.out.key++;
    this.arrived = -1;
  }

  /** A place to stand, facing a point: into the scratch target (nothing allocated). */
  private aim(x: number, y: number, fx: number, fy: number): Target {
    const w = this.want;
    w.x = x;
    w.y = y;
    w.facing = Math.atan2(fy - y, fx - x);
    delete w.z;
    return w;
  }

  /** Seconds since he arrived where he's going (−1: not there yet). Asked after `go`. */
  private held(f: CareFrame): number {
    const t = this.out.target;
    if (this.arrived < 0 && !f.galahad.moving && Math.hypot(f.galahad.x - t.x, f.galahad.y - t.y) < 1.3) this.arrived = f.now;
    return this.arrived < 0 ? -1 : (f.now - this.arrived) / 1000;
  }

  private look(x: number, y: number, z: number): void {
    const a = this.out.attention;
    a.x = x;
    a.y = y;
    a.z = z;
    a.on = true;
  }

  private next(): void {
    this.beat++;
    this.arrived = -1;
    this.sub = 0;
  }

  /** Back to the start of whatever comes next: the ball home, holds released. */
  private restart(): void {
    this.beat = 0;
    this.arrived = -1;
    this.sub = 0;
    this.ball = "held";
    this.throws = 0;
    this.field.preflight = false;
    this.flock.led = -1;
  }

  /** One frame of his life. */
  step(f: CareFrame): CareOut {
    const out = this.out;
    const pose = out.pose;
    pose.crouch = pose.reach = pose.throw = pose.tilt = pose.sit = pose.lie = pose.asleep = 0;
    out.attention.on = false;
    out.thinking = false;
    out.busy = false;
    out.writing = false;
    this.joy = 0;
    this.dogSleep = 0;
    this.talk(0);
    this.flock.gather.on = false;

    // The dog's battery: draining as it runs, charging on its dock (it stays there till it's full).
    const lead = this.dog.lead;
    const nearDock = Math.hypot(f.dog.x - DOCK.x, f.dog.y - DOCK.y) < 0.45;
    if (this.docked && this.charge >= FULL) this.docked = false;
    else if (!this.docked && nearDock && this.charge < FULL && lead.on && lead.x === DOCK.x && lead.y === DOCK.y) this.docked = true;
    if (f.motion) this.charge = stepCharge(this.charge, f.dt, f.dog.speed, this.docked);
    this.dog.charge.value = this.charge;
    if (this.charge >= LOW) this.chargePatted = false;
    const dogLow = this.charge < LOW && !this.chargePatted;

    const intent = intentFor({ working: f.working, concern: f.concern !== null, dogLow, motion: f.motion });
    // The work's done: the dog first (if he was at it a while, and it can come to him).
    if (intent === "work") this.worked += f.dt;
    else if (this.intent === "work") {
      if (this.worked >= PAT_AFTER && !f.galahad.raised && !this.docked && this.charge >= LOW) this.pat = PAT_S;
      this.worked = 0;
    }
    if (intent !== "life" && intent !== "concern") this.pat = 0;
    if (intent !== this.intent || (intent === "concern" && f.concern!.key !== this.lastConcern)) {
      this.intent = intent;
      this.lastConcern = f.concern?.key ?? "";
      this.restart();
    }
    out.intent = intent;

    // His day: the block for now (asked again only when it ends; a forced one for tours).
    if (!this.block || f.now >= this.block.end || f.now < this.block.start) this.block = lifeAt(f.now);
    const activity = this.forced ?? this.block.activity;
    if (activity !== this.activity) {
      this.activity = activity;
      if (intent === "life") this.restart();
    }

    // The dog: by him unless care sends it (to its dock, after a ball).
    lead.on = false;
    lead.sit = false;
    lead.lie = false;
    lead.run = false;
    lead.faceX = lead.faceY = Number.NaN;
    if (this.docked || (this.charge < CRITICAL && intent === "work")) this.toDockLead();

    if (intent === "work") out.label = "";
    else if (intent === "still") {
      this.go(DECK_REST);
      out.label = STILL_LABEL;
    } else if (this.pat > 0) this.welcome(f);
    else if (intent === "concern") this.tend(f.concern!, f);
    else if (intent === "charge") this.toDock(f);
    else this.live(f);

    // The dog's mood: keen when it's playing, greeted or patted; tired when it's low; at peace asleep.
    const mood = this.dog.mood;
    const playing = this.ball === "flying" || this.ball === "resting" || this.ball === "carried" || pose.reach > 0 || this.joy > 0;
    const low = this.charge < LOW;
    const asleep = this.dogSleep > 0;
    const e = f.motion ? 1 - Math.exp(-f.dt * 3) : 1;
    mood.wag += ((asleep ? 0 : low ? 0.12 : playing ? 1 : 0.5) - mood.wag) * e;
    mood.ears += ((asleep ? 0.2 : low ? 0.1 : this.ball === "flying" || this.ball === "resting" || this.joy > 0 ? 1 : 0.6) - mood.ears) * e;
    mood.eye += ((asleep ? 0.07 : low ? 0.35 : 1) - mood.eye) * e;
    mood.joy += (this.joy - mood.joy) * (f.motion ? 1 - Math.exp(-f.dt * 5) : 1);
    mood.asleep += (this.dogSleep - mood.asleep) * (f.motion ? 1 - Math.exp(-f.dt * 1.5) : 1);
    if (this.ball === "carried") this.dog.mouth(this.ballAt);
    return out;
  }

  /** The dog to its cushion: it lies there (charging), its head towards his bed. */
  private toDockLead(): void {
    this.dogDown(DOCK.x, DOCK.y, BED.x - 0.5, BED.y);
  }

  /** The dog to a spot by him, lying there, facing a point. */
  private dogDown(x: number, y: number, faceX: number, faceY: number): void {
    // (While it charges it stays on its cushion, wherever he sits.)
    if (this.docked && (x !== DOCK.x || y !== DOCK.y)) return;
    const lead = this.dog.lead;
    lead.on = true;
    lead.x = x;
    lead.y = y;
    lead.sit = true;
    lead.lie = true;
    lead.run = false;
    lead.faceX = faceX;
    lead.faceY = faceY;
  }

  /** Seated with the dog lying by him: every `every` seconds he reaches down and pats it for three (true while he does). */
  private patSeated(f: CareFrame, held: number, every: number): boolean {
    if (held % every < every - 3.2 || Math.hypot(f.dog.x - f.galahad.x, f.dog.y - f.galahad.y) > 1.5) return false;
    this.look(f.dog.x, f.dog.y, 0.42);
    this.out.pose.reach = 1;
    return true;
  }

  /** The work's done: before anything else the dog comes bounding to his feet, and he crouches and pats it. */
  private welcome(f: CareFrame): void {
    const g = f.galahad;
    const lead = this.dog.lead;
    this.out.label = "Work's done: the dog first";
    if (this.sub === 0) {
      // He stays where the work left him, turned to the dog.
      this.sub = 1;
      const far = Math.hypot(f.dog.x - g.x, f.dog.y - g.y) > 0.3;
      this.go(this.aim(g.x, g.y, far ? f.dog.x : g.x + Math.cos(g.heading), far ? f.dog.y : g.y + Math.sin(g.heading)));
    }
    const t = this.out.target;
    const fx = t.x + Math.cos(t.facing) * 0.95;
    const fy = t.y + Math.sin(t.facing) * 0.95;
    lead.on = true;
    lead.x = fx;
    lead.y = fy;
    lead.sit = true;
    lead.run = true;
    this.joy = 1;
    this.look(f.dog.x, f.dog.y, 0.5);
    if (Math.hypot(f.dog.x - fx, f.dog.y - fy) < 0.5 && !g.moving) {
      this.out.pose.crouch = 1;
      this.out.pose.reach = 1;
      this.pat -= f.dt;
    } else this.pat -= f.dt * 0.25;
    if (this.pat <= 0) this.restart();
  }

  /** What needs you: he goes to where it is and stays, concerned, until it's resolved or dismissed. */
  private tend(c: HeartbeatFinding, f: CareFrame): void {
    const out = this.out;
    if (!out.label.startsWith("Needs you: ") || out.label.length !== c.title.length + 11 || !out.label.endsWith(c.title)) out.label = `Needs you: ${c.title}`;
    let x = 0;
    let y = 0;
    let z = 1.4;
    switch (c.place) {
      case "node":
        if (c.node && f.nodeSpot(c.node, this.spot)) {
          // In front of its banner (or tower), between it and the way up to the keep.
          const r = Math.hypot(this.spot.x, this.spot.y) || 1;
          this.go(this.aim(this.spot.x * ((r - 2.3) / r), this.spot.y * ((r - 2.3) / r), this.spot.x, this.spot.y));
          x = this.spot.x;
          y = this.spot.y;
          z = 3;
        } else {
          this.go(AT.keep);
          x = STATIONS.keep.x;
          y = STATIONS.keep.y;
        }
        break;
      case "racks":
        this.go(RACK_STAND);
        x = RACKS.x;
        y = RACKS.y;
        z = 2;
        break;
      default:
        this.go(AT[c.place]);
        x = STATIONS[c.place].x;
        y = STATIONS[c.place].y;
    }
    if (this.held(f) >= 0) {
      this.look(x, y, z);
      out.thinking = true;
    }
  }

  /** The dog's low: he walks it to its cushion, sees it settled, pats it, and goes on with his day. */
  private toDock(f: CareFrame): void {
    this.out.label = "Taking the dog to its bed to charge";
    this.go(DOCK_STAND);
    this.toDockLead();
    if (this.held(f) < 0) return;
    this.look(DOCK.x, DOCK.y, 0.45);
    if (!this.docked) return;
    this.out.pose.crouch = 1;
    this.out.pose.reach = 1;
    if (this.sub === 0) {
      this.sub = 1;
      this.subAt = f.now;
    } else if (f.now - this.subAt > 3000) this.chargePatted = true;
  }

  /** His day, as the block says: a beat at a time. */
  private live(f: CareFrame): void {
    const out = this.out;
    const a = this.activity;
    out.label = ACTIVITY_LABEL[a];
    switch (a) {
      case "sleep":
        return this.sleep(f);
      case "wake":
        return this.wake(f);
      case "hearth":
        return this.byFire(f);
      case "journal":
        return this.journal(f);
      case "ponder":
        return this.ponder(f);
      case "walk":
        return this.trail(f);
      case "rounds": {
        const stop = roundsStop(this.block ? blockPhase(this.block, f.now) : 0);
        this.go(AT[stop]);
        const held = this.held(f);
        if (held >= 0) {
          this.look(STATIONS[stop].x, STATIONS[stop].y, 1.4);
          out.thinking = held % 9 > 5;
        }
        return;
      }
      case "library":
        this.go(AT.library);
        if (this.held(f) >= 0) {
          this.look(STATIONS.library.x, STATIONS.library.y, 1.1);
          out.busy = true;
        }
        return;
      case "observatory": {
        this.go(AT.observatory);
        const held = this.held(f);
        if (held >= 0) {
          this.look(STATIONS.observatory.x, STATIONS.observatory.y, 1.6);
          if (held % 40 < 20) out.thinking = true;
          else out.busy = true;
        }
        return;
      }
      case "council":
        this.go(AT.council);
        if (this.held(f) >= 0) {
          // Reachy Mini sits on the table; he and it look at each other and talk.
          this.look(STATIONS.council.x, STATIONS.council.y, 1.75);
          out.pose.tilt = 1;
          this.talk(1);
        }
        return;
      case "walk-dog":
        return this.walkDog(f);
      case "friends":
        return this.friends(f);
      case "workshop":
        return this.workshop(f);
      case "field":
        return this.provingGround(f);
    }
  }

  // ---------- his hearth: asleep, woken, the fire, his journal ----------

  /** Night: he lies back on his bed, the dog comes to its cushion against it, a last pat, and they sleep. */
  private sleep(f: CareFrame): void {
    this.go(BED);
    const held = this.held(f);
    if (held < 0) {
      this.out.label = "Turning in";
      return;
    }
    this.out.pose.lie = 1;
    this.toDockLead();
    const dogDown = Math.hypot(f.dog.x - DOCK.x, f.dog.y - DOCK.y) < 0.5;
    if (held < 7.5) {
      this.out.label = "Turning in: a last pat for the dog";
      if (held > 2 && dogDown) {
        this.look(f.dog.x, f.dog.y, 0.35);
        this.out.pose.reach = 1;
      }
      return;
    }
    this.out.pose.asleep = 1;
    if (dogDown) this.dogSleep = 1;
  }

  /** Morning: the dog's up first, on its feet by his bed with its tail going; he wakes, pats it from where he lies, gets up to it, and they sit by the fire till his rounds. */
  private wake(f: CareFrame): void {
    if (this.beat > 0) return this.byFire(f);
    this.go(BED);
    const held = this.held(f);
    if (held < 0) return;
    const lead = this.dog.lead;
    const pose = this.out.pose;
    if (held < 3) {
      // Still asleep, both of them.
      pose.lie = pose.asleep = 1;
      this.toDockLead();
      this.dogSleep = 1;
      return;
    }
    // The dog, up: sitting by him, watching him, then bouncing.
    lead.on = true;
    lead.x = DOCK.x;
    lead.y = DOCK.y;
    lead.sit = true;
    lead.lie = false;
    lead.faceX = BED.x - 0.4;
    lead.faceY = BED.y;
    this.joy = held > 6 ? 1 : 0.45;
    if (held < 6.5) {
      pose.lie = pose.asleep = 1;
      return;
    }
    this.look(f.dog.x, f.dog.y, 0.45);
    if (held < 12) {
      // Awake: a pat from where he lies.
      pose.lie = 1;
      pose.reach = held > 8 ? 1 : 0;
      return;
    }
    if (held < 18.5) {
      // Up, and down to it properly.
      pose.crouch = held > 14 ? 1 : 0;
      pose.reach = held > 14.5 ? 1 : 0;
      return;
    }
    this.next();
  }

  /** By the fire: seated on the log, looking into it, the dog lying at his side; a pat now and then. */
  private byFire(f: CareFrame): void {
    this.go(LOG_SEAT);
    const held = this.held(f);
    if (held < 0) return;
    this.out.pose.sit = 1;
    this.dogDown(LOG_DOG.x, LOG_DOG.y, FIRE.x, FIRE.y);
    this.look(FIRE.x, FIRE.y, 0.45);
    this.patSeated(f, held, 26);
  }

  /** His journal: seated at his desk, writing; he stops now and then, looks up and thinks back over the day; the dog lies by his chair. */
  private journal(f: CareFrame): void {
    this.go(DESK_SEAT);
    const held = this.held(f);
    if (held < 0) return;
    const out = this.out;
    out.pose.sit = 1;
    this.dogDown(DESK_DOG.x, DESK_DOG.y, DESK_SEAT.x, DESK_SEAT.y);
    if (held < 1.5) return;
    const k = held % 24;
    if (k > 17.5) {
      // Recollecting: his hand to his chin, looking out past the lantern.
      out.thinking = true;
      return;
    }
    out.writing = true;
    // Along the line and down the page, a little.
    this.look(JOURNAL.x + 0.1 + 0.05 * Math.sin(held * 0.9), JOURNAL.y - 0.02 * Math.sin(held * 0.13), JOURNAL.z);
  }

  /** The bench by the lake: seated, looking out over the water, thinking; the dog lies at his feet; a pat now and then. */
  private ponder(f: CareFrame): void {
    this.go(BENCH_SEAT);
    const held = this.held(f);
    if (held < 0) return;
    const out = this.out;
    out.pose.sit = 1;
    this.dogDown(BENCH_DOG.x, BENCH_DOG.y, BENCH_SEAT.x, BENCH_SEAT.y - 30);
    this.look(BENCH_SEAT.x + 6 * Math.sin(held * 0.05), BENCH_SEAT.y - 30, 0.4);
    if (this.patSeated(f, held, 34)) return;
    out.thinking = held % 50 > 22;
  }

  // ---------- out for a walk: the trail, the dog in front ----------

  private trail(f: CareFrame): void {
    const stop = TRAIL[this.beat % TRAIL.length]!;
    const g = f.galahad;
    this.go(this.aim(stop.x, stop.y, stop.look[0], stop.look[1]));
    const held = this.held(f);
    if (held < 0) {
      // A point he only passes: on to the next as he reaches it, without stopping.
      if (stop.pause <= 0 && Math.hypot(g.x - stop.x, g.y - stop.y) < 1.6) return this.next();
      // On the way the dog's out in front, leading (it stays on its cushion while it charges).
      if (g.moving && !this.docked) {
        const lead = this.dog.lead;
        lead.on = true;
        lead.x = g.x + Math.cos(g.heading) * 3.3;
        lead.y = g.y + Math.sin(g.heading) * 3.3;
        // Never into the water after it.
        if (f.wet(lead.x, lead.y)) lead.on = false;
      }
      return;
    }
    if (stop.pause <= 0) return this.next();
    // Looking out, the dog beside him; halfway through, down to it for a pat.
    this.look(stop.look[0], stop.look[1], 1.2);
    const at = held - stop.pause * 0.45;
    if (at > 0 && at < 4 && Math.hypot(f.dog.x - g.x, f.dog.y - g.y) < 1.8) {
      this.look(f.dog.x, f.dog.y, 0.45);
      this.out.pose.crouch = 1;
      this.out.pose.reach = at > 0.6 ? 1 : 0;
    }
    if (held > stop.pause) this.next();
  }

  // ---------- fetch with the dog ----------

  private walkDog(f: CareFrame): void {
    this.go(WALK[this.walk % WALK.length]!);
    const held = this.held(f);
    if (held < 0) return;
    // Charging at its dock: no game, a pause at each spot and on.
    if (this.docked) {
      if (held > 8) this.walk++;
      return;
    }
    const g = f.galahad;
    const lead = this.dog.lead;
    const pose = this.out.pose;
    switch (this.ball) {
      case "held": {
        if (this.throws >= 3) {
          // The game's done: a last pat, then walk on.
          pose.crouch = 1;
          pose.reach = 1;
          this.look(f.dog.x, f.dog.y, 0.45);
          if (this.sub === 0) {
            this.sub = 1;
            this.subAt = f.now;
          } else if (f.now - this.subAt > 2500) {
            this.throws = 0;
            this.walk++;
            this.sub = 0;
          }
          return;
        }
        // The throw: the ball leaves his hand at 55 % of it, for a dry spot ahead.
        if (this.sub === 0) {
          this.sub = 1;
          this.subAt = f.now;
          this.aimThrow(f);
        }
        const p = (f.now - this.subAt) / 900;
        pose.throw = Math.max(0.001, Math.min(1, p));
        this.look(this.to[0], this.to[1], 1);
        if (p >= 0.55) {
          this.ball = "flying";
          this.flight = 0;
          this.throws++;
        }
        return;
      }
      case "flying": {
        this.flight += f.dt / 1.3;
        pose.throw = this.flight < 0.35 ? 0.55 + this.flight * 1.3 : 0;
        ballFlight(this.from[0], this.from[1], this.from[2], this.to[0], this.to[1], this.to[2], this.flight, this.ballAt);
        // It runs for where the ball will land.
        this.fetchLead(f);
        this.look(this.ballAt[0], this.ballAt[1], this.ballAt[2]);
        if (this.flight >= 1) this.ball = "resting";
        return;
      }
      case "resting": {
        this.ballAt[0] = this.to[0];
        this.ballAt[1] = this.to[1];
        this.ballAt[2] = this.to[2] + 0.11;
        this.look(this.to[0], this.to[1], 0.3);
        if (this.fetchLead(f) < 0.62) this.ball = "carried";
        return;
      }
      case "carried": {
        // Back to him, to his feet; he takes it, and pats it.
        const fx = g.x + Math.cos(g.heading) * 0.9;
        const fy = g.y + Math.sin(g.heading) * 0.9;
        lead.on = true;
        lead.x = fx;
        lead.y = fy;
        lead.sit = true;
        this.look(f.dog.x, f.dog.y, 0.5);
        if (Math.hypot(f.dog.x - fx, f.dog.y - fy) < 0.45) {
          pose.crouch = 1;
          pose.reach = 1;
          if (this.sub !== 2) {
            this.sub = 2;
            this.subAt = f.now;
          } else if (f.now - this.subAt > 1600) {
            this.ball = "held";
            this.sub = 0;
          }
        }
        return;
      }
    }
  }

  /** The dog after the ball: to where it lands, its mouth over it (its middle stops short). Returns how far it is from the ball. */
  private fetchLead(f: CareFrame): number {
    const lead = this.dog.lead;
    const dx = this.to[0] - f.dog.x;
    const dy = this.to[1] - f.dog.y;
    const d = Math.hypot(dx, dy);
    lead.on = true;
    lead.run = true;
    lead.x = d > 0.42 ? this.to[0] - (dx / d) * 0.42 : f.dog.x;
    lead.y = d > 0.42 ? this.to[1] - (dy / d) * 0.42 : f.dog.y;
    return d;
  }

  /** A landing spot about seven metres ahead (turning aside for water), and his hand as the start. */
  private aimThrow(f: CareFrame): void {
    const g = f.galahad;
    let a = g.heading;
    for (let i = 0; i < 7; i++) {
      a = g.heading + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.55 + Math.sin(this.throws * 1.7 + this.walk) * 0.3;
      if (!f.wet(g.x + Math.cos(a) * 7.5, g.y + Math.sin(a) * 7.5)) break;
    }
    this.to[0] = g.x + Math.cos(a) * 7.5;
    this.to[1] = g.y + Math.sin(a) * 7.5;
    this.to[2] = f.height(this.to[0], this.to[1]);
    this.from[0] = g.x + Math.cos(g.heading - 0.6) * 0.3;
    this.from[1] = g.y + Math.sin(g.heading - 0.6) * 0.3;
    this.from[2] = f.height(g.x, g.y) + 2.1;
  }

  // ---------- his friends: the Microducks ----------

  /** Where he visits them: the flock's middle, out on open lawn (they keep clear of the keep and its stations). */
  private lawn(): void {
    const s = this.flock.middle(this.spot);
    const r = Math.hypot(s.x, s.y);
    let clear = r >= LAWN.min;
    for (const p of PLACES_AT) if (Math.hypot(s.x - p.x, s.y - p.y) < 5) clear = false;
    if (clear) return;
    s.x = LAWN.x;
    s.y = LAWN.y;
  }

  private friends(f: CareFrame): void {
    const flock = this.flock;
    const pose = this.out.pose;
    switch (this.beat % 4) {
      case 0: {
        // To the flock; they gather round; he crouches to look one over.
        if (this.sub === 0) {
          this.lawn();
          this.sub = 1;
          this.go(this.aim(this.spot.x - 0.6, this.spot.y - 0.6, this.spot.x, this.spot.y));
        }
        const held = this.held(f);
        if (held < 0) return;
        flock.gather.on = true;
        flock.gather.x = f.galahad.x;
        flock.gather.y = f.galahad.y;
        const duck = flock.near(f.galahad.x, f.galahad.y, 4);
        if (duck && held > 2) {
          pose.crouch = 1;
          pose.reach = held > 4 ? 1 : 0;
          this.look(duck.x, duck.y, 0.55);
        }
        if (held > 12) this.next();
        return;
      }
      case 1: {
        // One that's wandered far: he goes to it…
        if (this.sub === 0) {
          const s = flock.stray();
          this.sub = 1;
          if (s.index < 0 || s.distance < 9) {
            this.beat += 2;
            return;
          }
          this.stray = s.index;
          const d = flock.ducks[s.index]!;
          this.go(this.aim(d.x - 1.2, d.y - 0.8, d.x, d.y));
        }
        const d = flock.ducks[this.stray];
        if (!d) return this.next();
        const held = this.held(f);
        if (held < 0) return;
        this.look(d.x, d.y, 0.5);
        pose.crouch = 0.6;
        if (held > 3) {
          flock.led = this.stray;
          this.next();
        }
        return;
      }
      case 2: {
        // …and leads it home to the others.
        flock.led = this.stray;
        if (this.sub === 0) {
          this.sub = 1;
          this.lawn();
          this.go(this.aim(this.spot.x + 0.8, this.spot.y - 0.4, this.spot.x, this.spot.y));
        }
        if (this.held(f) < 0) return;
        flock.led = -1;
        this.next();
        return;
      }
      default: {
        // Watching them a while, then again.
        if (this.sub === 0) {
          this.sub = 1;
          this.arrived = f.now;
        }
        const held = this.held(f);
        flock.gather.on = true;
        flock.gather.x = f.galahad.x;
        flock.gather.y = f.galahad.y;
        this.out.thinking = true;
        if (held > 14) this.next();
      }
    }
  }

  // ---------- his companions in the workshop ----------

  private workshop(f: CareFrame): void {
    if (this.beat % 2 === 0) {
      // Clearing a finished print at the printer farm.
      this.go(PRINT_STAND);
      const held = this.held(f);
      if (held < 0) return;
      this.look(printerX(2), FARM.y, FARM.top + 0.3);
      if (held > 2) this.out.pose.reach = 1;
      if (held > 14) this.next();
    } else {
      // Looking over the assembly line's arms.
      this.go(ARMS_STAND);
      const held = this.held(f);
      if (held < 0) return;
      this.look(LINE.arms[0]!.x, LINE.arms[0]!.y, 1.5);
      this.out.thinking = held % 10 > 4;
      if (held > 16) this.next();
    }
  }

  // ---------- his companions on the proving ground ----------

  private provingGround(f: CareFrame): void {
    const r = this.field.residents;
    const pose = this.out.pose;
    switch (this.beat % 3) {
      case 0: {
        // The aircraft's walk-round, before it flies: only while it's at its tie-down (held there till he's done).
        const atTieDown = r.plane.phase === "idle" || r.plane.phase === "parked";
        if (!atTieDown && this.sub === 0) return this.next();
        this.field.preflight = true;
        const [x, y] = ROUND_PLANE[this.sub % ROUND_PLANE.length]!;
        this.go(this.aim(x, y, TIE_DOWN.x, TIE_DOWN.y));
        const held = this.held(f);
        if (held < 0) return;
        this.look(TIE_DOWN.x, TIE_DOWN.y, 1.2);
        this.out.thinking = this.sub % 2 === 1;
        if (held > 2.2) {
          this.sub++;
          this.arrived = -1;
          if (this.sub >= ROUND_PLANE.length) {
            this.field.preflight = false;
            this.next();
          }
        }
        return;
      }
      case 1: {
        // The quadcopter's pad: once it's down, he swaps its battery.
        this.go(QUAD_STAND);
        const held = this.held(f);
        if (held < 0) return;
        this.look(DRONE_PAD.x, DRONE_PAD.y, 0.4);
        const mode = r.drone.mode;
        if (mode === "charging" || mode === "landed") {
          pose.crouch = 1;
          pose.reach = 1;
          if (this.sub === 0) {
            this.sub = 1;
            this.subAt = f.now;
          } else if (f.now - this.subAt > 4000) {
            this.field.swapBattery();
            this.next();
          }
        } else if (held > 45) this.next();
        return;
      }
      default: {
        // The rover at its start gate: he looks it over as it comes by.
        this.go(ROVER_STAND);
        const held = this.held(f);
        if (held < 0) return;
        const rv = r.rover.pose;
        const near = Math.hypot(rv.x - f.galahad.x, rv.y - f.galahad.y) < 6;
        this.look(near ? rv.x : START_GATE.x, near ? rv.y : START_GATE.y, 0.8);
        if (near) pose.crouch = 0.8;
        if (held > (near ? 10 : 30)) this.next();
      }
    }
  }

  /** What the page's `?trace=1` reads of him (written in place). */
  trace(into: { activity: string; intent: string; charge: number; docked: boolean; ball: string; beat: number }): void {
    into.activity = this.activity;
    into.intent = this.intent;
    into.charge = this.charge;
    into.docked = this.docked;
    into.ball = this.ball;
    into.beat = this.beat;
  }
}

/** Drawn: the ball (while it's out of his hand), in the world root at its absolute place, as the characters are. (The dog's cushion is the hearth's: hearth.ts.) */
export class CareLook {
  private readonly ball: Mesh;
  private readonly ballMaterial = new MeshLambertMaterial({ color: 0xffa630, emissive: 0x6a2c00 });

  constructor(group: Group, shadows: boolean) {
    this.ball = new Mesh(new IcosahedronGeometry(0.11, 1), this.ballMaterial);
    this.ball.castShadow = shadows;
    this.ball.visible = false;
    group.add(this.ball);
  }

  /** The ball where care says (hidden while it's in his hand). */
  update(care: Care, ground: (x: number, y: number) => number, dt: number, motion: boolean): void {
    const shown = care.ball !== "held";
    if (this.ball.visible !== shown) this.ball.visible = shown;
    if (!shown) return;
    const p = care.ballAt;
    this.ball.position.set(p[0], Math.max(p[2], ground(p[0], p[1]) + 0.1), -p[1]);
    if (motion && care.ball === "flying") this.ball.rotation.x += dt * 9;
  }

  dispose(): void {
    this.ball.geometry.dispose();
    this.ballMaterial.dispose();
    this.ball.removeFromParent();
  }
}
