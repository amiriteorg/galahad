import { z } from "zod";

/*
 * The SANDBOX: an infinite synthetic world where Galahad is visible as he works, and
 * every experiment (a robot in MuJoCo or Gazebo, a plane in JSBSim, a rocket in
 * RocketPy, an Isaac scene on a GPU node) runs on its own plot, live.
 *
 * Coordinates are metres in a right-handed frame with z up (the simulators'
 * convention): x east, y north. A world renderer converts to its own. The node
 * streams `WorldEvent`s (GET /api/world, server-sent events); nothing in them is a
 * secret, and what Galahad reads (the bank, your chats) appears only as what he's
 * doing, never the content.
 */

/** A shape a simulated body is drawn as (metres; local frame, z up). */
export type BodyShape =
  | { kind: "box"; size: [number, number, number] }
  | { kind: "sphere"; radius: number }
  /** Along local z. */
  | { kind: "capsule"; radius: number; length: number }
  | { kind: "cylinder"; radius: number; length: number }
  | { kind: "plane"; size: [number, number] }
  /** Small meshes only: at most 20 000 vertices (x,y,z flat) and their triangle indices. */
  | { kind: "mesh"; vertices: number[]; indices: number[] }
  /** Stand-ins drawn by the world itself (nose along local +x, up +z). */
  | { kind: "aircraft"; span: number; length: number }
  | { kind: "rocket"; radius: number; length: number };

export interface SceneBody {
  id: string;
  shape: BodyShape;
  /** #rrggbb */
  color?: string;
  /** Never moves (the ground, a table): its pose comes in the first frame only (none yet: the plot's origin). */
  fixed?: boolean;
  label?: string;
  /** Leave a trail behind it (aircraft, rockets, an end effector). */
  trail?: boolean;
}

export type ExperimentEngine = "mujoco" | "gazebo" | "isaac" | "jsbsim" | "rocketpy" | "custom";
export type ExperimentStatus = "starting" | "running" | "done" | "failed";

/** A simulation running somewhere in the fleet, on its own plot of the world. */
export interface ExperimentView {
  id: string;
  title: string;
  engine: ExperimentEngine;
  status: ExperimentStatus;
  /** Where it stands in the world: the plot's centre (metres) and its side length. The node allots plots; they never overlap. */
  plot: { x: number; y: number; size: number };
  /** How the experiment's own coordinates sit on the plot: scale them, then offset by the plot's centre. A flight test far bigger than a plot is scaled down. */
  scale: number;
  scene: SceneBody[];
  startedAt: number;
  endedAt: number | null;
  /** The node and sandbox it runs in, and the quest it's part of. */
  nodeName: string;
  sandbox: string | null;
  quest: string | null;
  /** The latest scalar readouts (altitude_m, speed_mps, reward, error…). */
  metrics: Record<string, number>;
  /** How it ended, in a line. */
  summary: string | null;
}

/** Position x,y,z (metres) and orientation as a unit quaternion w,x,y,z. */
export type Pose = [number, number, number, number, number, number, number];

/** One frame: every moving body's pose at simulation time t (seconds); the first frame also poses the fixed ones. */
export interface ExperimentFrame {
  experiment: string;
  t: number;
  poses: Record<string, Pose>;
  metrics?: Record<string, number>;
}

/** Where Galahad goes for each kind of work: the places of his keep, near the world's origin. */
export type Station =
  | "keep" // fleet, notices, loops, the ledger: his hall
  | "council" // thinking an answer through
  | "library" // memory and kept work
  | "watchtower" // the web
  | "treasury" // the bank
  | "messenger" // your services (connectors)
  | "forge" // sandboxes and code
  | "oracle" // decisions
  | "observatory" // investigations and trials
  | "field"; // out on an experiment's plot

/** What Galahad is doing right now, as the world shows it. */
export interface GalahadState {
  station: Station;
  /** One line: "Reading the bank: transactions", "Searching the web: rocket nozzle expansion ratio". */
  doing: string;
  /** The experiment he's out at, when station is "field". */
  experiment: string | null;
  /** The model thinking for him, when he's thinking. */
  model: string | null;
  since: number;
}

export interface WorldNode {
  id: string;
  name: string;
  kind: "node" | "client";
  online: boolean;
  self: boolean;
  sandboxHost: boolean;
}

export type WorldEvent =
  /** The whole world as it is now: first, on every (re)connect. */
  | { type: "hello"; at: number; galahad: GalahadState; nodes: WorldNode[]; experiments: ExperimentView[]; thoughts: string[] }
  /** He moved or started something else. */
  | { type: "galahad"; at: number; galahad: GalahadState }
  /** A line of what he's thinking or saying (short; the world shows it in a bubble). */
  | { type: "thought"; at: number; text: string }
  /** An experiment appeared, changed status, or ended. */
  | { type: "experiment"; at: number; experiment: ExperimentView }
  /** Poses of an experiment's bodies (a few to 30 a second). */
  | { type: "frame"; at: number; frame: ExperimentFrame }
  | { type: "fleet"; at: number; nodes: WorldNode[] }
  /** Something needs you (a notice, an approval waiting). */
  | { type: "notice"; at: number; severity: "info" | "warn" | "error"; title: string };

/** Which station a tool sends him to. */
export function stationForTool(name: string): Station {
  if (name.startsWith("bank_")) return "treasury";
  if (name.startsWith("sandbox_")) return "forge";
  if (name.startsWith("connector")) return "messenger";
  if (name === "recall" || name === "remember" || name.startsWith("artifact")) return "library";
  if (name === "web_search") return "watchtower";
  if (name === "decide") return "oracle";
  if (name.startsWith("experiment")) return "field";
  return "keep";
}

/** Where each station stands (metres from the origin, z up). Fixed: every renderer agrees. */
export const STATIONS: Record<Exclude<Station, "field">, { x: number; y: number; label: string }> = {
  keep: { x: 0, y: 0, label: "The keep" },
  council: { x: 0, y: 14, label: "Council table" },
  library: { x: -18, y: 8, label: "Library" },
  watchtower: { x: 20, y: 18, label: "Watchtower" },
  treasury: { x: -16, y: -12, label: "Treasury" },
  messenger: { x: 18, y: -10, label: "Messenger's post" },
  forge: { x: 30, y: 2, label: "Forge" },
  oracle: { x: -30, y: -2, label: "Oracle" },
  observatory: { x: -8, y: 30, label: "Observatory" },
};

/* ---------- what a simulation sends (through its sandbox's gateway), checked at the node ---------- */

const Finite = z.number().finite();
const Size = z.number().finite().positive().max(10_000);
const BodyId = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);

export const BodyShapeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("box"), size: z.tuple([Size, Size, Size]) }),
  z.strictObject({ kind: z.literal("sphere"), radius: Size }),
  z.strictObject({ kind: z.literal("capsule"), radius: Size, length: z.number().finite().min(0).max(10_000) }),
  z.strictObject({ kind: z.literal("cylinder"), radius: Size, length: Size }),
  z.strictObject({ kind: z.literal("plane"), size: z.tuple([Size, Size]) }),
  z
    .strictObject({ kind: z.literal("mesh"), vertices: z.array(Finite).max(60_000), indices: z.array(z.number().int().min(0)).max(120_000) })
    .refine((m) => m.vertices.length % 3 === 0 && m.indices.length % 3 === 0 && m.indices.every((i) => i < m.vertices.length / 3), "vertices are x,y,z triples; indices name them in triangles"),
  z.strictObject({ kind: z.literal("aircraft"), span: Size, length: Size }),
  z.strictObject({ kind: z.literal("rocket"), radius: Size, length: Size }),
]);

export const SceneBodySchema = z.strictObject({
  id: BodyId,
  shape: BodyShapeSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fixed: z.boolean().optional(),
  label: z.string().max(60).optional(),
  trail: z.boolean().optional(),
});

/** A new experiment: what it is and what it draws. `extent` is how far it spans (metres), so the node can scale it onto its plot. */
export const ExperimentStart = z.strictObject({
  title: z.string().trim().min(1).max(120),
  engine: z.enum(["mujoco", "gazebo", "isaac", "jsbsim", "rocketpy", "custom"]),
  scene: z.array(SceneBodySchema).min(1).max(500),
  extent: z.number().finite().positive().max(10_000_000).optional(),
  plot: z.enum(["small", "medium", "large"]).optional(),
});

const PoseSchema = z.tuple([Finite, Finite, Finite, Finite, Finite, Finite, Finite]);
const Metrics = z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/), Finite).refine((m) => Object.keys(m).length <= 24, "at most 24 metrics");

export const ExperimentFrames = z.strictObject({
  frames: z
    .array(z.strictObject({ t: z.number().finite().min(0), poses: z.record(BodyId, PoseSchema).refine((p) => Object.keys(p).length <= 500, "at most 500 bodies"), metrics: Metrics.optional() }))
    .min(1)
    .max(120),
});

export const ExperimentEnd = z.strictObject({
  status: z.enum(["done", "failed"]),
  summary: z.string().max(300).optional(),
  metrics: Metrics.optional(),
});
