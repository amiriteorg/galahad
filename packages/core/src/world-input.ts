import { z } from "zod";

/*
 * What a simulation sends the world (through its sandbox's gateway), checked at the node.
 * Kept apart from world.ts so the world's renderer bundle needs no zod.
 */
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

/**
 * A new experiment: what it is and what it draws. `extent` is how far it spans (metres), so the node can scale it onto its plot.
 * `site` asks for the proving ground ("field"), the workshop hall ("hall") or open land ("open"); without it the node chooses
 * (padKindFor in world.ts), and falls back to open land when the site's pads are taken.
 */
export const ExperimentStart = z.strictObject({
  title: z.string().trim().min(1).max(120),
  engine: z.enum(["mujoco", "gazebo", "isaac", "jsbsim", "rocketpy", "custom"]),
  scene: z.array(SceneBodySchema).min(1).max(500),
  extent: z.number().finite().positive().max(10_000_000).optional(),
  plot: z.enum(["small", "medium", "large"]).optional(),
  site: z.enum(["field", "hall", "open"]).optional(),
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

/** How the world ran on a device: what the page reports, so problems on a phone can be seen from a terminal. Nothing personal: the device, the renderer, its numbers, its errors. */
export const WorldReport = z.strictObject({
  session: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  mode: z.enum(["live", "demo", "fallback"]),
  backend: z.enum(["webgpu", "webgl2", "none"]),
  tier: z.string().max(20),
  dpr: z.number().finite().min(0).max(8),
  fps: z.strictObject({ now: z.number().finite().min(0).max(1000), avg: z.number().finite().min(0).max(1000), min: z.number().finite().min(0).max(1000) }),
  frameMs: z.number().finite().min(0).max(100_000),
  drawCalls: z.number().int().min(0).max(1_000_000),
  shadows: z.boolean(),
  viewport: z.tuple([z.number().int().min(0).max(100_000), z.number().int().min(0).max(100_000), z.number().finite().min(0).max(8)]),
  userAgent: z.string().max(400),
  adapter: z.string().max(300).optional(),
  restarts: z.number().int().min(0).max(100),
  experiments: z.number().int().min(0).max(1000),
  /** The latest things that happened: started, slow, reset, error, warning, fallback. */
  events: z.array(z.strictObject({ at: z.number().int(), kind: z.enum(["start", "slow", "lost", "restart", "fallback", "error", "warning"]), text: z.string().max(600) })).max(40),
});
