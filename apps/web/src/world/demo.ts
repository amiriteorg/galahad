import type { ExperimentStatus, ExperimentView, GalahadState, Pose, SceneBody, Station, WorldEvent, WorldNode } from "@galahad/core/world";
import { axisAngle, mulQuat, type Quat } from "./pose.ts";

/*
 * A scripted world for when the node doesn't stream one yet (GET /api/world answers
 * 404): Galahad walking between his stations with thoughts, a robot arm reaching,
 * a rocket launching again and again, a plane flying circuits, and one finished
 * rover test. The page always labels it a demo; none of it is real.
 */

export interface Demo {
  hello(now: number): WorldEvent;
  /** Every event due since the last call: state changes, and a frame per moving experiment. */
  step(now: number): WorldEvent[];
}

interface Beat {
  station: Station;
  doing: string;
  experiment?: string;
  model?: string;
  thoughts: string[];
}

const ARM = "demo-arm";
const ROCKET = "demo-rocket";
const PLANE = "demo-plane";
const ROVER = "demo-rover";

/** What he does, in order, each for BEAT_S seconds, round and round. */
const SCRIPT: Beat[] = [
  { station: "keep", doing: "Checking on the fleet", thoughts: ["Every node answered. Good."] },
  { station: "council", doing: "Thinking an answer through: how high will the rocket go?", model: "demo-model", thoughts: ["Thrust over weight first, then drag.", "About 900 metres, if the motor behaves."] },
  { station: "library", doing: "Recalling memory: the last three launches", thoughts: ["The last flight weathercocked in the wind."] },
  { station: "watchtower", doing: "Searching the web: drogue parachute descent rates", thoughts: ["Twenty-five metres a second under a drogue is usual."] },
  { station: "forge", doing: "Running code in a sandbox: fitting the thrust curve", thoughts: ["The fit is within two per cent."] },
  { station: "field", doing: "Watching the rocket fly", experiment: ROCKET, thoughts: ["Liftoff.", "Apogee soon. The drift is small."] },
  { station: "observatory", doing: "Reading the trial results", thoughts: ["The index went up a little."] },
  { station: "field", doing: "Checking the robot arm's reach", experiment: ARM, thoughts: ["The elbow overshoots. Lower the gain."] },
  { station: "treasury", doing: "Reading the bank: balances", thoughts: ["Nothing unusual this week."] },
  { station: "messenger", doing: "Calling a connector: open issues", thoughts: ["Two new issues; one is a duplicate."] },
  { station: "field", doing: "Following the plane's circuit", experiment: PLANE, thoughts: ["Holding 500 metres in the bank. Steady."] },
  { station: "oracle", doing: "Deciding which nozzle to keep", model: "demo-model", thoughts: ["The shorter nozzle, by a whisker."] },
];
/** Long enough to walk there and get some work done. */
const BEAT_S = 22;
const FRAME_MS = 50;

const NODES: WorldNode[] = [
  { id: "demo-node-1", name: "keep-node", kind: "node", online: true, self: true, sandboxHost: false },
  { id: "demo-node-2", name: "sandbox-host", kind: "node", online: true, self: false, sandboxHost: true },
  { id: "demo-node-3", name: "spare", kind: "node", online: false, self: false, sandboxHost: false },
  { id: "demo-client-1", name: "phone", kind: "client", online: true, self: false, sandboxHost: false },
];

const Z: [number, number, number] = [0, 0, 1];
const Y: [number, number, number] = [0, 1, 0];
const X: [number, number, number] = [1, 0, 0];
const pose = (p: [number, number, number], q: Quat): Pose => [p[0], p[1], p[2], q[0], q[1], q[2], q[3]];
const round = (x: number, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits;

// ---------- the robot arm (MuJoCo) ----------

const ARM_SCENE: SceneBody[] = [
  { id: "table", shape: { kind: "box", size: [1.6, 1.2, 0.06] }, color: "#b98b5e", fixed: true },
  { id: "base", shape: { kind: "cylinder", radius: 0.12, length: 0.12 }, color: "#4b4f58", fixed: true },
  { id: "upper", shape: { kind: "capsule", radius: 0.05, length: 0.5 }, color: "#e8833a" },
  { id: "fore", shape: { kind: "capsule", radius: 0.04, length: 0.42 }, color: "#e8833a" },
  { id: "gripper", shape: { kind: "box", size: [0.08, 0.08, 0.1] }, color: "#3d4048", trail: true, label: "gripper" },
  { id: "target", shape: { kind: "sphere", radius: 0.04 }, color: "#3fa36b" },
];

function armPoses(t: number, first: boolean): { poses: Record<string, Pose>; metrics: Record<string, number> } {
  const q1 = 0.9 * Math.sin(0.4 * t);
  const q2 = 0.65 + 0.35 * Math.sin(0.7 * t);
  const q3 = 0.9 + 0.4 * Math.sin(0.9 * t + 1);
  const yaw = axisAngle(Z, q1);
  const shoulder: [number, number, number] = [0, 0, 0.18];
  const d1: [number, number, number] = [Math.cos(q1) * Math.sin(q2), Math.sin(q1) * Math.sin(q2), Math.cos(q2)];
  const elbow: [number, number, number] = [shoulder[0] + 0.5 * d1[0], shoulder[1] + 0.5 * d1[1], shoulder[2] + 0.5 * d1[2]];
  const d2: [number, number, number] = [Math.cos(q1) * Math.sin(q2 + q3), Math.sin(q1) * Math.sin(q2 + q3), Math.cos(q2 + q3)];
  const wrist: [number, number, number] = [elbow[0] + 0.42 * d2[0], elbow[1] + 0.42 * d2[1], elbow[2] + 0.42 * d2[2]];
  const mid = (a: number[], b: number[]): [number, number, number] => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2];
  const target: [number, number, number] = [0.55 * Math.cos(0.25 * t), 0.4 * Math.sin(0.25 * t), 0.25];
  const error = Math.hypot(wrist[0] - target[0], wrist[1] - target[1], wrist[2] - target[2]);
  const poses: Record<string, Pose> = {
    upper: pose(mid(shoulder, elbow), mulQuat(yaw, axisAngle(Y, q2))),
    fore: pose(mid(elbow, wrist), mulQuat(yaw, axisAngle(Y, q2 + q3))),
    gripper: pose(wrist, mulQuat(yaw, axisAngle(Y, q2 + q3))),
    target: pose(target, [1, 0, 0, 0]),
  };
  if (first) {
    poses.table = pose([0, 0, -0.03], [1, 0, 0, 0]);
    poses.base = pose([0, 0, 0.06], [1, 0, 0, 0]);
  }
  return { poses, metrics: { reach_error_m: round(error, 3), reward: round(1 - Math.min(1, error), 3) } };
}

// ---------- the rocket (RocketPy) ----------

const ROCKET_SCENE: SceneBody[] = [
  { id: "pad", shape: { kind: "box", size: [60, 60, 2] }, color: "#8f8a80", fixed: true },
  { id: "rail", shape: { kind: "box", size: [1.5, 1.5, 60] }, color: "#5d6068", fixed: true },
  { id: "rocket", shape: { kind: "rocket", radius: 0.08, length: 2.2 }, color: "#f2f0ea", trail: true, label: "rocket" },
];
const ROCKET_CYCLE_S = 75;
const PAD_S = 6;

interface Flight {
  status: ExperimentStatus;
  pos: [number, number, number];
  pitch: number;
  speed: number;
}

/** A simple flight: 3 s burn at 4 g, coast to about 900 m, then down under a drogue, drifting downwind. */
function flight(t: number): Flight {
  if (t < PAD_S) return { status: "starting", pos: [0, 0, 1.1], pitch: Math.PI / 2, speed: 0 };
  const f = t - PAD_S;
  const burn = 3;
  const a = 40;
  const vb = a * burn;
  const hb = 0.5 * a * burn * burn;
  const tApogee = burn + vb / 9.81;
  const apogee = hb + (vb * vb) / (2 * 9.81);
  const descent = 25;
  const tLand = tApogee + apogee / descent;
  const drift = (s: number) => 2.2 * s;
  if (f < burn) return { status: "running", pos: [drift(f), 0, 1.1 + 0.5 * a * f * f], pitch: Math.PI / 2 - 0.03 * f, speed: a * f };
  if (f < tApogee) {
    const c = f - burn;
    const v = vb - 9.81 * c;
    return { status: "running", pos: [drift(f), 0, 1.1 + hb + vb * c - 0.5 * 9.81 * c * c], pitch: Math.PI / 2 - 0.09 - 0.25 * (c / (tApogee - burn)), speed: Math.max(0, v) };
  }
  if (f < tLand) return { status: "running", pos: [drift(f), 0, 1.1 + apogee - descent * (f - tApogee)], pitch: Math.PI / 2, speed: descent };
  return { status: "done", pos: [drift(tLand), 0, 1.1], pitch: Math.PI / 2, speed: 0 };
}

/** Nose along local +x, pitched up from the horizon by `pitch` (downrange is +x). */
const rocketQuat = (pitch: number): Quat => axisAngle(Y, -pitch);

// ---------- the plane (JSBSim) ----------

const PLANE_SCENE: SceneBody[] = [
  { id: "runway", shape: { kind: "plane", size: [900, 60] }, color: "#7d7b74", fixed: true },
  { id: "plane", shape: { kind: "aircraft", span: 11, length: 8.5 }, color: "#d9dde3", trail: true, label: "plane" },
];
const CIRCUIT_R = 700;
const AIRSPEED = 60;

function planePoses(t: number, first: boolean): { poses: Record<string, Pose>; metrics: Record<string, number> } {
  const w = AIRSPEED / CIRCUIT_R;
  const a = w * t;
  const alt = 500 + 25 * Math.sin(0.2 * t);
  const heading = a + Math.PI / 2;
  const bank = 0.35;
  const poses: Record<string, Pose> = { plane: pose([CIRCUIT_R * Math.cos(a), CIRCUIT_R * Math.sin(a), alt], mulQuat(axisAngle(Z, heading), axisAngle(X, -bank))) };
  if (first) poses.runway = pose([0, 0, 0.5], [1, 0, 0, 0]);
  return { poses, metrics: { altitude_m: round(alt, 1), airspeed_kt: round(AIRSPEED * 1.944, 1), bank_deg: round((bank * 180) / Math.PI, 1) } };
}

// ---------- the rover (Gazebo, finished) ----------

const wheel = (id: string): SceneBody => ({ id, shape: { kind: "cylinder", radius: 0.16, length: 0.1 }, color: "#2f3137" });
const ROVER_SCENE: SceneBody[] = [
  { id: "ramp", shape: { kind: "box", size: [2.4, 1.4, 0.1] }, color: "#c7b28d", fixed: true },
  { id: "chassis", shape: { kind: "box", size: [0.8, 0.5, 0.22] }, color: "#d4a63a" },
  wheel("w1"),
  wheel("w2"),
  wheel("w3"),
  wheel("w4"),
];

function roverPoses(): Record<string, Pose> {
  const slope = (12 * Math.PI) / 180;
  const tilt = axisAngle(Y, -slope);
  const axle = mulQuat(tilt, axisAngle(X, Math.PI / 2));
  const cx = 0.5;
  const cz = 0.35 + cx * Math.tan(slope);
  const at = (dx: number, dy: number, dz: number): [number, number, number] => [cx + dx * Math.cos(slope), dy, cz + dx * Math.sin(slope) + dz];
  return {
    ramp: pose([0.4, 0, 0.12 + 0.4 * Math.tan(slope)], tilt),
    chassis: pose(at(0, 0, 0.05), tilt),
    w1: pose(at(0.3, 0.3, -0.1), axle),
    w2: pose(at(0.3, -0.3, -0.1), axle),
    w3: pose(at(-0.3, 0.3, -0.1), axle),
    w4: pose(at(-0.3, -0.3, -0.1), axle),
  };
}

export function createDemo(start: number): Demo {
  const experiment = (over: Partial<ExperimentView> & Pick<ExperimentView, "id" | "title" | "engine" | "plot" | "scale" | "scene">): ExperimentView => ({
    status: "running",
    startedAt: start,
    endedAt: null,
    nodeName: "sandbox-host",
    sandbox: null,
    quest: "Demo quest",
    metrics: {},
    summary: null,
    ...over,
  });
  const arm = experiment({ id: ARM, title: "Robot arm: reaching a moving target", engine: "mujoco", plot: { x: 64, y: 34, size: 20 }, scale: 5, scene: ARM_SCENE, sandbox: "demo-lab-1" });
  const plane = experiment({ id: PLANE, title: "Light aircraft: a 500 m circuit", engine: "jsbsim", plot: { x: 30, y: -78, size: 36 }, scale: 0.02, scene: PLANE_SCENE, sandbox: "demo-lab-2" });
  let rocket = experiment({ id: ROCKET, title: "Sounding rocket: launch and recovery", engine: "rocketpy", plot: { x: -58, y: 54, size: 24 }, scale: 0.05, scene: ROCKET_SCENE, status: "starting", sandbox: "demo-lab-3" });
  const rover = experiment({
    id: ROVER,
    title: "Rover: wheel slip on a 12° ramp",
    engine: "gazebo",
    plot: { x: -66, y: -42, size: 20 },
    scale: 2,
    scene: ROVER_SCENE,
    status: "done",
    startedAt: start - 40 * 60_000,
    endedAt: start - 25 * 60_000,
    metrics: { slip_pct: 3.6, climb_deg: 12 },
    summary: "Slip stayed under 4 % on loose sand; it climbed the 12° ramp.",
    sandbox: "demo-lab-0",
  });

  let beat = -1;
  let lastFrame = 0;
  let firstFrames = true;
  let noticeSent = false;
  const thoughtsSaid = new Set<string>();

  const galahadAt = (i: number, now: number): GalahadState => {
    const b = SCRIPT[i % SCRIPT.length]!;
    return { station: b.station, doing: b.doing, experiment: b.experiment ?? null, model: b.model ?? null, since: now };
  };

  return {
    hello(now) {
      beat = Math.floor((now - start) / 1000 / BEAT_S);
      const thoughts = SCRIPT[((beat % SCRIPT.length) + SCRIPT.length) % SCRIPT.length]!.thoughts.slice(0, 1);
      return { type: "hello", at: now, galahad: galahadAt(Math.max(0, beat), now), nodes: NODES, experiments: [rover, arm, rocket, plane], thoughts };
    },
    step(now) {
      const events: WorldEvent[] = [];
      const s = (now - start) / 1000;
      const nextBeat = Math.floor(s / BEAT_S);
      if (nextBeat !== beat && nextBeat >= 0) {
        beat = nextBeat;
        thoughtsSaid.clear();
        events.push({ type: "galahad", at: now, galahad: galahadAt(beat, now) });
      }
      // His thoughts come a few seconds into each beat, one after another.
      const script = beat >= 0 ? SCRIPT[beat % SCRIPT.length]! : { thoughts: [] };
      script.thoughts.forEach((text, i) => {
        const due = beat * BEAT_S + 2.5 + i * 3;
        if (s >= due && !thoughtsSaid.has(text)) {
          thoughtsSaid.add(text);
          events.push({ type: "thought", at: now, text });
        }
      });
      if (!noticeSent && s > 20) {
        noticeSent = true;
        events.push({ type: "notice", at: now, severity: "info", title: "A sample notice (demo)" });
      }

      // The rocket's status follows its flight.
      const cycleT = s % ROCKET_CYCLE_S;
      const f = flight(cycleT);
      const rocketStatus: ExperimentStatus = f.status === "done" ? "running" : f.status;
      if (rocketStatus !== rocket.status) {
        rocket = { ...rocket, status: rocketStatus, startedAt: rocketStatus === "starting" ? now : rocket.startedAt };
        events.push({ type: "experiment", at: now, experiment: rocket });
      }

      if (now - lastFrame >= FRAME_MS) {
        lastFrame = now;
        const first = firstFrames;
        firstFrames = false;
        const a = armPoses(s, first);
        events.push({ type: "frame", at: now, frame: { experiment: ARM, t: round(s, 3), poses: a.poses, metrics: a.metrics } });
        const p = planePoses(s, first);
        events.push({ type: "frame", at: now, frame: { experiment: PLANE, t: round(s, 3), poses: p.poses, metrics: p.metrics } });
        const rocketPoses: Record<string, Pose> = { rocket: pose(f.pos, rocketQuat(f.pitch)) };
        if (first) {
          rocketPoses.pad = pose([0, 0, 1], [1, 0, 0, 0]);
          rocketPoses.rail = pose([0, 0, 31], [1, 0, 0, 0]);
        }
        events.push({ type: "frame", at: now, frame: { experiment: ROCKET, t: round(cycleT, 3), poses: rocketPoses, metrics: { altitude_m: round(f.pos[2], 1), speed_mps: round(f.speed, 1) } } });
        if (first) events.push({ type: "frame", at: now, frame: { experiment: ROVER, t: 900, poses: roverPoses() } });
      }
      return events;
    },
  };
}
