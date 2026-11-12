import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chalkboard } from "../../apps/web/src/world/board.ts";
import { Critters } from "../../apps/web/src/world/critters.ts";
import { RobotDog } from "../../apps/web/src/world/dog.ts";
import * as animals from "../../apps/web/src/world/eco/models.ts";
import { ProvingGround } from "../../apps/web/src/world/field.ts";
import { models as flora } from "../../apps/web/src/world/flora-models.ts";
import { Workshop } from "../../apps/web/src/world/hall.ts";
import { Hearth } from "../../apps/web/src/world/hearth.ts";
import { Keep } from "../../apps/web/src/world/keep.ts";
import { Knight } from "../../apps/web/src/world/knight.ts";
import { Partners } from "../../apps/web/src/world/partners.ts";
import { PlanSlate } from "../../apps/web/src/world/plan-slate.ts";
import { loadRobot, ROBOT_ASSET_PATH } from "../../apps/web/src/world/robots/load.ts";
import { Horizon, Landmarks } from "../../apps/web/src/world/scenery.ts";
import { type TierName, TIERS } from "../../apps/web/src/world/tiers.ts";
import type { Geometry, ObjectLike } from "./audit.ts";

/*
 * Every model the world draws, as its own code builds it, headless: the knight
 * and his dog, the keep and what stands round it, the two sites, the animals,
 * everything that grows, the distance, and the robots (their stand-ins made by
 * code, and the real ones as the page loads them from its own files). Nothing
 * here draws: a model is built, read and let go.
 *
 * Each says what it is: how tall it should stand and where its lowest point
 * should be (scene space, y up, metres), and how many triangles it may have.
 * The budgets are stated here: where docs/WORLD.md gives a figure it's that one,
 * with a little room; elsewhere it's what the model had when the audit was
 * written, with a tenth to spare, so a model that grows is noticed.
 */

export type Tiered<T> = T | Record<TierName, T>;
export const ofTier = <T>(value: Tiered<T>, tier: TierName): T => (typeof value === "object" && value !== null && "low" in (value as object) ? (value as Record<TierName, T>)[tier] : (value as T));

export interface Built {
  /** A tree of objects with meshes in it, or bare geometries. */
  root?: ObjectLike;
  geometries?: Geometry[];
  dispose?(): void;
}

export interface Builder {
  name: string;
  /** Built differently by tier (null: one model for every device). */
  tiers: readonly TierName[] | null;
  build(tier: TierName): Built | Promise<Built>;
  /** Triangles at most. */
  budget: Tiered<number>;
  /** How tall it stands, and where its lowest point is (min, max). Absent: not held to any. */
  height?: [number, number];
  base?: [number, number];
  /** Its bounds are its skinned body's (what it carries is put in its hand as it moves). */
  body?: boolean;
  /** Brought in from a robot's own description by scripts/robots/build.ts, not made by the world's code. */
  imported?: boolean;
}

const ALL: readonly TierName[] = ["low", "medium", "high"];
const flat = (): number => 0;
const context = (tier: TierName) => ({ tier: TIERS[tier], shadows: false, ground: flat });
/** A group to build into, of the same three.js the world's own code uses. */
const group = (): ObjectLike & { add(child: unknown): unknown } => new (new Knight(false).root.constructor as new () => ObjectLike & { add(child: unknown): unknown })();
const place = (made: { group: unknown; dispose?(): void }): Built => ({ root: made.group as ObjectLike, dispose: () => made.dispose?.() });

/**
 * The chalkboard and his slate paint their faces on a canvas, which only a browser has. Their frames and stands are
 * what's audited: while one is built, a canvas that takes every stroke and keeps none stands in.
 */
function withCanvas<T>(build: () => T): T {
  const global = globalThis as { document?: unknown };
  const had = global.document;
  const context: unknown = new Proxy(function () {}, {
    get: (_, key) => (key === "measureText" ? () => ({ width: 10 }) : key === "canvas" ? canvas : context),
    set: () => true,
    apply: () => context,
  });
  const canvas = { width: 2, height: 2, style: {}, getContext: () => context, addEventListener: () => {}, removeEventListener: () => {} };
  global.document = { createElement: () => canvas };
  try {
    return build();
  } finally {
    global.document = had;
  }
}

const WORLD = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "web", "src", "world");
/** The page fetches a robot's files from the node; here they're read from where the node serves them. */
const fromDisk = (async (url: string | URL | Request): Promise<Response> => {
  // (A file's address carries its content's version after a "?": the file is the same.)
  const name = String(url).slice(ROBOT_ASSET_PATH.length).split("?")[0]!;
  if (!/^[a-z0-9.-]+$/.test(name)) return new Response(null, { status: 404 });
  return new Response(readFileSync(join(WORLD, "assets", "robots", name)));
}) as typeof fetch;

const robot = (name: string, budget: number): Builder => ({
  name: `robot.${name}`,
  tiers: null,
  budget,
  imported: true,
  build: async () => ({ geometries: [...(await loadRobot(name, fromDisk)).geometries.values()] as unknown as Geometry[] }),
});

const animal = (name: keyof typeof animals, height: [number, number] | undefined, base: [number, number] | undefined, budget = 800): Builder => ({
  name: `animal.${name}`,
  tiers: null,
  budget,
  ...(height ? { height } : {}),
  ...(base ? { base } : {}),
  build: () => ({ geometries: [(animals[name] as () => unknown)() as Geometry] }),
});

type FloraName = keyof typeof flora;
const plant = (name: FloraName, budget: number, height?: [number, number], detail?: 0 | 1): Builder => ({
  name: `flora.${name}${detail === undefined ? "" : detail ? ".near" : ".mid"}`,
  tiers: null,
  budget,
  ...(height ? { height, base: [-0.6, 0.15] as [number, number] } : {}),
  build: () => ({ geometries: [(flora[name] as (detail?: 0 | 1) => unknown)(detail) as Geometry] }),
});

const TREES: FloraName[] = ["oak", "round", "parasol", "birch", "blossom", "pine", "spruce", "alder", "willow"];

export const BUILDERS: Builder[] = [
  // Galahad is a knight of about two and a half metres (the world's own scale), his feet on the ground.
  { name: "knight", tiers: null, budget: 10_500, height: [2.1, 2.7], base: [-0.03, 0.03], body: true, build: () => ({ root: new Knight(false).root as unknown as ObjectLike }) },
  { name: "dog", tiers: null, budget: 3_500, height: [0.6, 1.2], base: [-0.06, 0.03], body: true, build: () => ({ root: new RobotDog(false).root as unknown as ObjectLike }) },
  // The keep with its stations and its great tree, on its own ground; its beacon's beam is its top.
  { name: "keep", tiers: null, budget: 38_000, height: [15, 55], base: [-4, 0.2], build: () => place(new Keep(false, TIERS.high.lights)) },
  { name: "hearth", tiers: ALL, budget: 4_300, height: [1.5, 4.5], base: [-0.3, 0.1], build: (tier) => place(new Hearth(context(tier))) },
  { name: "chalkboard", tiers: null, budget: 450, height: [1.8, 4], base: [-0.2, 0.1], build: () => withCanvas(() => place(new Chalkboard(context("high")))) },
  { name: "slate", tiers: null, budget: 350, height: [1.2, 3], base: [-0.2, 0.1], build: () => withCanvas(() => place(new PlanSlate(context("high")))) },
  // The sites. docs/WORLD.md: the proving ground about 21, 29 and 51 thousand triangles (the high tier's with the real
  // rover, 9 thousand, which is its own entry below); the hall about 20, 37 and 54 thousand.
  { name: "proving-ground", tiers: ALL, budget: { low: 23_000, medium: 31_500, high: 46_000 }, height: [8, 40], base: [-1.5, 0.3], build: (tier) => place(new ProvingGround(context(tier))) },
  { name: "workshop", tiers: ALL, budget: { low: 21_500, medium: 41_000, high: 59_500 }, height: [6, 25], base: [-2, 0.3], build: (tier) => place(new Workshop(context(tier))) },
  {
    name: "robot-stand-ins",
    tiers: ALL,
    budget: 650,
    build: (tier) => {
      const root = group();
      const critters = new Critters(root as never, TIERS[tier].microducks, { height: flat, blocked: () => false } as never, false);
      return { root, dispose: () => (critters as unknown as { dispose?(): void }).dispose?.() };
    },
  },
  {
    name: "helpers",
    tiers: null,
    budget: 700,
    build: () => {
      const root = group();
      const partners = new Partners(root as never, false);
      return { root, dispose: () => (partners as unknown as { dispose?(): void }).dispose?.() };
    },
  },
  { name: "horizon", tiers: null, budget: 3_600, build: () => place(new Horizon()) },
  { name: "landmarks", tiers: null, budget: 5_500, build: () => place(new Landmarks(flat, false)) },
  // The real robots, simplified by the build to these budgets (docs/WORLD.md).
  robot("open-duck-mini-v2", 25_000),
  robot("so-101", 15_000),
  robot("reachy-mini", 30_000),
  robot("open-source-rover", 9_000),
  // The animals: "a few hundred triangles" each, drawn about one and a half times life, standing on the ground.
  animal("roe", [1.2, 2.4], [-0.03, 0.06]),
  animal("hare", [0.3, 0.9], [-0.03, 0.06]),
  animal("fox", [0.5, 1.2], [-0.03, 0.06]),
  animal("hedgehog", [0.12, 0.5], [-0.03, 0.06]),
  animal("squirrel", [0.2, 0.7], [-0.03, 0.06]),
  animal("mallard", [0.2, 0.8], undefined),
  animal("swan", [0.5, 1.8], undefined),
  animal("heron", [0.9, 2.2], [-0.03, 0.06]),
  animal("bird", undefined, undefined),
  animal("swallow", undefined, undefined),
  animal("goose", undefined, undefined),
  animal("kestrel", undefined, undefined),
  animal("owl", undefined, undefined),
  animal("bat", undefined, undefined),
  animal("insect", undefined, undefined, 100),
  animal("fishShadow", undefined, undefined, 100),
  animal("ring", undefined, undefined, 100),
  // What grows. Trees near (many small facets) and farther; then the far models, bushes, rocks and deadwood, reeds, and what's small.
  ...TREES.flatMap((name) => [plant(name, 1_050, [3.5, 14], 1), plant(name, 430, [3.5, 14], 0)]),
  ...(["farBroad", "farBirch", "farBlossom", "farConifer", "farSpruce"] as const).map((name) => plant(name, 100, [3, 14])),
  plant("bush", 250, [0.4, 2.2]),
  plant("farBush", 44, [0.4, 2.2]),
  plant("fern", 65, [0.2, 1.4]),
  plant("gorse", 190, [0.4, 2]),
  plant("heatherMound", 90, [0.1, 1]),
  plant("boulder", 110, [0.4, 2.5]),
  plant("slab", 110, [0.3, 2.5]),
  plant("log", 150, [0.2, 1.2]),
  plant("reeds", 95, [0.8, 3.2]),
  plant("farReeds", 12, [0.8, 3.2]),
  plant("rushes", 75, [0.3, 1.6]),
  ...(["daisy", "lupine", "lavender", "buttercup", "campion", "anemone", "heather", "grass", "lush", "marram", "clover", "pebbles", "mushrooms", "litter", "driftwood", "lily"] as const).map((name) => plant(name, 120)),
];
