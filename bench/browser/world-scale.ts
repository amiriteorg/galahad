/*
 * The SANDBOX at scale, measured in a real browser.
 *
 *   bun bench/browser/world-scale.ts             the quick matrix (a few minutes)
 *   bun bench/browser/world-scale.ts --full      the whole matrix (most of an hour)
 *   --only=<regex>   only the loads whose id matches       --capped        leave the browser's 60 Hz limit on
 *   --windows=3 --seconds=6   how each scene is measured   --shots=<dir>   a screenshot of every scene
 *   --profile        a sampled CPU profile of the base scenes (where the main thread's time goes, by function)
 *   --patience=120   seconds to wait for a quiet machine before a scene is measured anyway (and says so)
 *   --looks=<name:x,y,distance,yaw;…>   more scenes for every load: the view put there (for screenshots of a place)
 *   --season=live    every load in that season instead of its own (summer, unless a load says otherwise)
 *   --profile-load=<file>   a sampled CPU profile of each load's first seconds, every function's own time with its callers
 *   --out=<file>     where the scorecard's JSON goes (default bench/out/world-scale.json; the raw results beside it)
 *
 * It starts a throwaway node on a temp home (never ~/.galahad, never a service), opens the SANDBOX in headless
 * Edge over CDP, paired as a client, and loads the world once per configuration (`?trace=1&tier=…&webgl=…&animals=…
 * &reach=…&plants=…`: apps/web/src/world/bench.ts), then measures each scene of that load in windows of a few
 * seconds, several times, and keeps the median and the spread (the machine is shared: one window proves little).
 *
 * What's measured, and why it can be trusted:
 * - The main thread's time a frame (median, 95th and 99th percentile, the longest), and its parts: clocked inside
 *   the page's own frame function (performance.now() at each part's end), every frame, in rings that allocate nothing.
 * - The GPU's time a frame: WebGPU timestamp queries round every render pass (three's `trackTimestamp`; the
 *   browser is started with developer features so they aren't rounded to 0.1 ms). That is the GPU's own clock.
 * - The frame's interval with the cap lifted: the browser runs with its frame-rate limit and vsync off and the
 *   world draws every frame it's offered, so the interval is what the whole pipeline takes, on either backend
 *   (WebGL2 has no timestamp queries here). At 60 Hz the cap hides everything under 16.7 ms; this doesn't.
 * - Draw calls and triangles (the renderer's own count over all passes of a frame), the JS heap (after a forced
 *   collection), the vertex data the scene holds (every buffer once) and the GPU process's dedicated memory as
 *   Windows counts it.
 * - From navigation to the first frame and to a settled world (nothing left to grow for twenty frames), and the
 *   frames that grew land on the way and while the view flies over fresh country (the hitches).
 * - The bundle's size, as the node serves it.
 *
 * The machine is shared, and a busy one runs everything on one thread at half speed (measured: the same scene took
 * 5.6 ms a frame on a quiet machine and 10.0 ms on a busy one). So a scene waits a while for a quiet machine
 * (`--patience`: the node's kernel on one thread, against the best this machine has ever done, kept beside the
 * results). And a small fixed loop is run on the page's own main thread, the thread being measured, before, between
 * and after a scene's windows, and compared with the best that loop has ever done here: every time on the CPU's
 * clock (the main thread's, the frame's interval) is scaled by how quiet that thread's machine was round its
 * window, to what it would be at its best. A quiet machine isn't scaled at all. Each result says how quiet it was
 * (`quiet`) and keeps what was measured unscaled beside it (`raw`). The GPU's own time isn't scaled.
 *
 * No phone is measured: "phone" is the phone's size and pixel ratio (and touch) in this desktop browser, on the
 * low and medium tiers, with the CPU slowed four times where it says so. The GPU here is a desktop's.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { routes } from "../../packages/core/src/index.ts";
import { foundFleet, MindStore } from "../../packages/mind/src/index.ts";
import { kernel } from "../../packages/node/src/compute/bench.ts";
import { startDaemon } from "../../packages/node/src/daemon.ts";
import { Home } from "../../packages/node/src/home.ts";

const REPO = resolve(import.meta.dir, "../..");
const EDGE = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
/** The world's own seed (terrain.ts' SEED) and the ecosystem's (fauna.ts): every run sees the same land and the same animals' dice. */
const SEED = "land 0x6a1a4ad (relief.ts' SEED), ecosystem 0x5eed (fauna.ts)";

/**
 * A sampled profile's functions, by the kind of work they do: each sample goes to the nearest function up its
 * stack that one of these names (the bundle is minified, but methods keep their names; the world's own functions
 * don't, so the frame's own parts say where its time goes outside the renderer). The first that fits.
 */
const WORK: [string, RegExp][] = [
  ["idle", /^\(idle\)$/],
  ["garbage collection", /^\(garbage collector\)$/],
  ["the browser's own (native)", /^\(program\)$/],
  ["matrices", /^(updateMatrixWorld|updateWorldMatrix|updateMatrix|multiplyMatrices|compose|updateProjectionMatrix|multiply|premultiply)$/],
  ["culling and sorting", /^(project|_projectObject|intersectsObject|intersectsSprite|intersectsSphere|sort|pushLight|push|unshift)$/],
  ["pass begin, end and submit", /^(submit|finishRender|beginRender|beginRenderPass|createCommandEncoder|_getRenderPassDescriptor|finish|beginCompute|finishCompute|resolveOccludedAsync|_resolveRenderTarget)$/],
  ["vertex data checks and uploads", /^(updateAttributes|updateAttribute|updateIndex|get needsGeometryUpdate|getAttributes|getIndex|getDrawParameters)$/],
  ["uniforms and bindings", /^(_update|_updateBindings|updateBinding|updateBindings|updateNumber|updateVector2|updateVector3|updateVector4|updateColor|updateMatrix3|updateMatrix4|updateByType|updateReference|updateBeforeNode|updateAfterNode|updateNode|updateGroup|updateForRender|update|needsRefresh|equals)$/],
  ["draw calls (GPU commands)", /^(_draw|draw|setVertexBuffer|setBindGroup|setPipeline|setIndexBuffer|drawIndexed|setStencilReference|setViewport|setScissorRect)$/],
  ["per-object pipeline and cache checks", /^(get|getForRender|_needsRenderUpdate|needsRenderUpdate|getCacheKey|getDynamicCacheKey|getMaterialCacheKey|getGeometryCacheKey|getChainMap|getPipeline|_getRenderPipeline|getRenderCacheKey|getNodeBuilderState|getMonitor)$/],
  ["the draw loop itself", /^(_renderObjectDirect|renderObject|_renderObjects|_handleObjectFunction|_renderScene|render|_renderBundles|renderAsync)$/],
];
/** And by pass: under the sun's shadow map's render, under another render of the scene (the scene's own, the post effects', his eyes'), or outside the renderer. */
const SHADOW = /^(renderShadow|updateShadow)$/;
const RENDER = /^(render|_renderScene)$/;


const flag = (name: string): string | undefined => {
  const hit = Bun.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "";
};
const FULL = flag("full") !== undefined;
const CAPPED = flag("capped") !== undefined;
const PROFILE = flag("profile") !== undefined;
const ONLY = flag("only") ? new RegExp(flag("only")!) : null;
const WINDOWS = Number(flag("windows")) || (FULL ? 3 : 2);
const SECONDS = Number(flag("seconds")) || 4;
const SHOTS = flag("shots");
const PATIENCE = Number(flag("patience") ?? 20);
/** A part's cost: this many pairs (without it, with it), each side this many seconds. */
const PAIRS = Number(flag("pairs")) || (FULL ? 6 : 4);
const PAIR_SECONDS = 2;
/** A curve is broken where its 95th percentile frame, as measured, passes this (ms). */
const BROKEN_MS = 1000 / 15;
/** Quiet enough to measure: the kernel at this share of the machine's best. */
const QUIET = 0.8;
const OUT = resolve(flag("out") || join(REPO, "bench/out/world-scale.json"));

type TierName = "low" | "medium" | "high";
type ViewName = "desktop" | "phone" | "wide";

/** A screen: CSS size, device pixel ratio, touch. */
const VIEWS: Record<ViewName, { width: number; height: number; dpr: number; mobile: boolean }> = {
  desktop: { width: 1280, height: 800, dpr: 1, mobile: false },
  /** A phone held upright (an iPhone's 390 × 844 at three device pixels a CSS pixel; the tier caps the ratio it draws at). */
  phone: { width: 390, height: 844, dpr: 3, mobile: true },
  /** A large desktop window on a dense screen: the resolution the high tier's ratio of 2 really means. */
  wide: { width: 1920, height: 1080, dpr: 2, mobile: false },
};

/** One load of the page: a tier, a backend, a screen and how much world is asked for. */
interface Load {
  id: string;
  tier: TierName;
  webgl?: boolean;
  view: ViewName;
  animals?: number;
  reach?: number;
  plants?: number;
  /** His day fixed to one part of it (`?life=`). */
  life?: string;
  season?: "spring" | "summer" | "autumn" | "winter";
  weather?: "clear" | "mist" | "rain" | "snow" | "storm";
  eyes?: boolean;
  sound?: boolean;
  /** The CPU slowed this many times (CDP's throttle). */
  cpu?: number;
  /** A curve this load is a point of (its loads come in rising order): once a point breaks, the rest aren't tried. */
  series?: string;
  scenes: Scene[];
}

/** One thing measured in a load. */
interface Scene {
  id: string;
  /** Run in the page before measuring (an expression; may be a promise). */
  page?: string;
  /** Run here before measuring (the node's side: his work, helpers, experiments). */
  node?: (ctx: Ctx) => Promise<void> | void;
  /** Run after measuring (put back what was changed). */
  after?: string;
  /** The view flies over fresh country while it's measured (m/s). */
  fly?: number;
  /** Seconds to let it settle before measuring (default 2.5). */
  settle?: number;
  profile?: boolean;
  /**
   * A part of the picture, measured against the whole: `without` takes it away, `back` puts it back, and the two are
   * measured turn about, a couple of seconds each, several times. What the part costs is the median difference
   * between each pair: on a shared machine two measurements seconds apart agree far better than two minutes apart.
   */
  part?: { without: string; back: string };
}

interface Spread {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}
interface FrameStats {
  frames: number;
  seconds: number;
  interval: Spread;
  work: Spread;
  growing: Spread;
  gpu: Spread;
  parts: Record<string, number>;
  worst: { parts: Record<string, number>; flags: number };
  slow: { at: number; ms: number; part: string; partMs: number; flags: number }[];
  over16: number;
  over33: number;
  over50: number;
}
interface Drawn {
  calls: number;
  /** The objects the renderer was handed in a frame, all passes (its time goes by these; three's "draw calls" count the draws inside an object too). */
  objects: number;
  triangles: number;
  width: number;
  height: number;
  dpr: number;
  shadows: boolean;
  effects: string[];
  animals: number;
  slots: number;
  insects: number;
  chunks: number;
  fine: number;
  plants: Record<string, number>;
  plantTriangles: number;
  geometries: number;
  textures: number;
}
interface Result {
  id: string;
  load: string;
  scene: string;
  tier: TierName;
  backend: string;
  view: ViewName;
  animals: number;
  reach: number;
  plants: number;
  cpu: number;
  windows: number;
  /** Medians over the windows. */
  frames: number;
  fps: number;
  work: Spread;
  interval: Spread;
  gpu: Spread;
  growing: Spread;
  parts: Record<string, number>;
  /** What a part of the picture costs (a scene with `part`): the whole picture less the picture without it, the median of the pairs, and half their range. */
  cost?: { pairs: number; cpu: number; cpuSpread: number; render: number; gpu: number; calls: number; objects: number; triangles: number };
  /** The longest frame of all the windows, part by part (ms), and what it was doing (1 growing land, 2 filling plants, 4 drawing his eyes). */
  worst: { parts: Record<string, number>; flags: number };
  /**
   * How quiet the machine was while this was measured: the node's kernel on one thread round each window, as a
   * share of the best this machine has done (1: as quiet as it gets), the least of the windows'. The times above
   * are scaled by it, window by window; `raw` is the main thread's and the interval's 95th percentile as measured.
   */
  quiet: number;
  raw: { work95: number; interval95: number };
  /** Frames in a thousand whose main-thread time passed 16.7, 33.3 and 50 ms. */
  over16: number;
  over33: number;
  over50: number;
  /** Half the range over the windows of the main thread's 95th percentile, the interval's, and the GPU's median. */
  spread: { work95: number; interval95: number; gpu50: number };
  drawn: Drawn;
  megapixels: number;
  heapMb: number;
  buffersMb: number;
  gpuMb: number | null;
  /** The load's own: ms from navigation to the GPU ready, shaders compiled, first frame, settled; the frames that grew land on the way, and the longest frame of the load, part by part. */
  timing?: { init: number; compiled: number; first: number; settled: number; hitches: Spread; worst: Record<string, number>; slow: FrameStats["slow"] };
  profile?: Record<string, number>;
}

interface Ctx {
  daemon: Awaited<ReturnType<typeof startDaemon>>;
  evaluate: (expression: string) => Promise<unknown>;
}

// ---------- the scenes ----------

const B = "globalThis.__sandboxBench";
/** The view from high over the keep, looking north over the meadows: as much of the world as a view shows. */
const WIDE = "globalThis.__sandboxLook(0, 10, 130, Math.PI / 2)";
const day = (extra = ""): string => `(${B}.time("day"), ${WIDE}${extra ? `, ${extra}` : ""})`;

const base: Scene = { id: "wide-day", page: day(), profile: true };
const night: Scene = { id: "wide-night", page: `(${B}.time("night"), ${WIDE})` };
const dusk: Scene = { id: "wide-dusk", page: `(${B}.time("golden"), ${WIDE})` };
const close: Scene = { id: "close-day", page: `(${B}.time("day"), document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true })))`, settle: 4 };

/** His helpers at the forge and six agents beside him (the hub is told directly, as a quest and agents' calls would tell it). */
const company: Scene = {
  id: "helpers-partners",
  page: `(${B}.time("day"), globalThis.__sandboxLook(-20, 4, 40, 0.4))`,
  settle: 9,
  node: ({ daemon }) => {
    const stations = ["forge", "forge", "forge", "observatory", "council", "forge"];
    const compute = { nodes: [{ id: daemon.identity.id, name: "bench", slots: 6, inUse: 6, queued: 2, strength: 10 }], attempts: stations.map((station, i) => ({ id: `q-bench.${i + 1}`, quest: "q-bench", index: i + 1, of: stations.length, label: `Attempt ${i + 1} of ${stations.length}`, station, node: "bench", since: Date.now() })) };
    daemon.world.setCompute(() => compute as never);
    daemon.world.computeChanged();
    daemon.world.doing("council", "Leading 6 attempts at a quest");
    for (let i = 0; i < 6; i++) daemon.world.partner(`agent-${i + 1}`, "forge", "Running code");
  },
};

/** Experiments on their plots, their bodies moving: `n` of them, each with `bodies` bodies posed thirty times a second. */
function experiments(n: number, bodies: number): Scene {
  return {
    id: `experiments-${n}`,
    page: day(),
    settle: 6,
    node: async ({ daemon }) => {
      const origin = { nodeName: "bench", sandbox: null, quest: null };
      for (let e = 0; e < n; e++) {
        const scene = Array.from({ length: bodies }, (_, b) => ({ id: `b${b}`, shape: b % 3 === 0 ? { kind: "box" as const, size: [0.4, 0.4, 0.4] as [number, number, number] } : b % 3 === 1 ? { kind: "sphere" as const, radius: 0.25 } : { kind: "capsule" as const, radius: 0.15, length: 0.6 }, trail: b === 0 }));
        const started = daemon.world.start({ title: `Bench rig ${e + 1}`, engine: "custom", scene, extent: 6, site: "open" }, origin);
        const pose = (t: number): Record<string, [number, number, number, number, number, number, number]> => Object.fromEntries(scene.map((body, b) => [body.id, [Math.cos(t + b) * 2, Math.sin(t * 1.3 + b) * 2, 1 + 0.5 * Math.sin(t * 2 + b), 1, 0, 0, 0]]));
        daemon.world.phase(started.id, started.key, { phase: "building", poses: pose(0) });
        daemon.world.phase(started.id, started.key, { phase: "testing" });
        let t = 0;
        const timer = setInterval(() => {
          t += 1 / 30;
          try {
            daemon.world.frames(started.id, started.key, { frames: [{ t, poses: pose(t), metrics: { energy_j: Math.sin(t) } }] });
          } catch {
            clearInterval(timer);
          }
        }, 33);
        timers.push(timer);
      }
    },
  };
}
const timers: ReturnType<typeof setInterval>[] = [];

/** His day, part by part, the view following him close. */
const follow = `document.querySelector(".world-look-btn") && !/^\\s*Galahad/.test(document.querySelector(".world-look-btn").innerText) && document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }))`;
const dayPart = (id: string, activity: string | null, time: "day" | "night", node?: Scene["node"]): Scene => ({
  id: `${id}-${time}`,
  page: `(${B}.time("${time}"), globalThis.__sandboxLife.force(${JSON.stringify(activity)}), ${follow})`,
  node,
  settle: 9,
});
const atForge: Scene["node"] = ({ daemon }) => {
  daemon.world.doing("forge", "Running code in a sandbox");
  const timer = setInterval(() => daemon.world.doing("forge", "Running code in a sandbox"), 5000);
  timers.push(timer);
};
const rested: Scene["node"] = ({ daemon }) => {
  for (const t of timers.splice(0)) clearInterval(t);
  daemon.world.rest(100);
};
const hisDay = (): Scene[] => (["day", "night"] as const).flatMap((time) => [dayPart("asleep", "sleep", time, rested), dayPart("walk", "walk", time), dayPart("fetch", "walk-dog", time), dayPart("forge", null, time, atForge)]);

/**
 * What each part of the picture costs the GPU and the main thread: each taken away and put back, turn about with the
 * whole picture (see Scene.part).
 */
const ablations = (which: string[]): Scene[] => {
  const all = { ao: true, shafts: true, bloom: true };
  const hide = (what: string[], hidden: boolean): string => `(${what.map((w) => `${B}.hide("${w}", ${hidden})`).join(", ")})`;
  const parts: Record<string, { without: string; back: string }> = {
    shadows: { without: `${B}.shadows(false)`, back: `${B}.shadows(true)` },
    post: { without: `${B}.post({ ao: false, shafts: false, bloom: false })`, back: `${B}.post(${JSON.stringify(all)})` },
    built: { without: hide(["keep", "places"], true), back: hide(["keep", "places"], false) },
  };
  for (const what of ["plants", "land", "wildlife", "people", "folk", "sky"]) parts[what] = { without: hide([what], true), back: hide([what], false) };
  return which.map((name, i) => ({ id: `cost-${name}`, page: i ? "0" : day(), part: parts[name]!, settle: i ? 0.5 : 2.5 }));
};
/** The resolution's slope: the same scene at four pixel ratios (the GPU's time against megapixels: the slope is shading, the rest geometry and passes). */
const ratios = (list: number[], back: number): Scene[] => list.map((r, i) => ({ id: `ratio-${r}`, page: `${B}.dpr(${r})`, after: i === list.length - 1 ? `${B}.dpr(${back})` : undefined }));
const weathers: Scene[] = [
  { id: "rain", page: `${B}.weather("rain")`, settle: 4 },
  { id: "storm", page: `${B}.weather("storm")`, settle: 4 },
  { id: "snow", page: `${B}.weather("snow")`, settle: 4, after: `${B}.weather("clear")` },
];
const eyesOn = `(() => { const p = document.querySelector(".world-eyes"); if (!p || p.hidden) document.dispatchEvent(new KeyboardEvent("keydown", { key: "v", bubbles: true })); })()`;
const eyesOff = `(() => { const p = document.querySelector(".world-eyes"); if (p && !p.hidden) document.dispatchEvent(new KeyboardEvent("keydown", { key: "v", bubbles: true })); })()`;
const eyesScenes: Scene[] = [
  { id: "eyes-closed", page: `(${day()}, ${eyesOff})` },
  { id: "eyes-open", page: eyesOn },
  { id: "eyes-swapped", page: `document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }))`, after: `(document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true })), ${eyesOff})` },
];
const fly: Scene = { id: "fly", page: `(${B}.time("day"), globalThis.__sandboxLook(0, 10, 60, Math.PI / 2))`, fly: 30, settle: 3 };

const TIERS: TierName[] = ["high", "medium", "low"];
/** The screen a tier is for: the high tier is a desktop's; phones top out at medium. */
const SCREEN: Record<TierName, ViewName> = { high: "desktop", medium: "phone", low: "phone" };

function loads(): Load[] {
  const out: Load[] = [];
  if (!FULL) {
    // The quick matrix: each tier on its own screen, the two ends of each curve, his walk, a flight over fresh land.
    for (const tier of TIERS) out.push({ id: `base.${tier}.webgpu.${SCREEN[tier]}`, tier, view: SCREEN[tier], scenes: [base, ...(tier === "high" ? [close, fly] : [])] });
    out.push({ id: "base.low.webgl2.phone", tier: "low", webgl: true, view: "phone", scenes: [base] });
    for (const tier of ["high", "medium"] as const) out.push({ id: `animals.${tier}.x16`, tier, view: SCREEN[tier], animals: 16, season: "spring", scenes: [dusk] });
    out.push({ id: "animals.high.x1", tier: "high", view: "desktop", season: "spring", scenes: [dusk] });
    out.push({ id: "animals.medium.x1", tier: "medium", view: "phone", season: "spring", scenes: [dusk] });
    for (const tier of ["high", "medium"] as const) out.push({ id: `reach.${tier}.x2`, tier, view: SCREEN[tier], reach: 2, scenes: [base] });
    out.push({ id: "day.high", tier: "high", view: "desktop", life: "walk", scenes: [dayPart("walk", "walk", "day")] });
    out.push({ id: "parts.high.desktop", tier: "high", view: "desktop", scenes: ablations(["folk", "shadows", "post", "plants", "land"]) });
    out.push({ id: "parts.medium.phone", tier: "medium", view: "phone", scenes: ablations(["folk", "plants", "land"]) });
    // With his friends, the Microducks gathered round him, close up: the robots as large in the view as they get.
    out.push({ id: "friends.high", tier: "high", view: "desktop", life: "friends", scenes: [dayPart("friends", "friends", "day")] });
    return out;
  }
  // ---- every tier on both backends, at a desktop's size and a phone's ----
  for (const tier of TIERS) {
    for (const webgl of [false, true]) {
      for (const view of ["desktop", "phone"] as const) {
        const own = !webgl && view === SCREEN[tier];
        out.push({ id: `base.${tier}.${webgl ? "webgl2" : "webgpu"}.${view}`, tier, webgl, view, scenes: own ? [base, night, close, ...weathers, fly] : [base] });
      }
    }
  }
  // A dense desktop screen (the high tier at a pixel ratio of 2), and the resolution's slope there and on a phone.
  out.push({ id: "pixels.high.wide", tier: "high", view: "wide", scenes: [base, ...ratios([0.5, 1, 1.5, 2], 2)] });
  out.push({ id: "pixels.medium.phone", tier: "medium", view: "phone", scenes: ratios([1, 1.5, 2, 3], 1.5) });
  // What each part costs.
  out.push({ id: "parts.high.desktop", tier: "high", view: "desktop", scenes: ablations(["shadows", "post", "plants", "land", "wildlife", "built", "folk", "people"]) });
  out.push({ id: "parts.medium.phone", tier: "medium", view: "phone", scenes: ablations(["plants", "land", "wildlife", "folk"]) });
  // A slow phone's CPU (four times slower than this machine's).
  for (const tier of ["medium", "low"] as const) out.push({ id: `slowcpu.${tier}.phone`, tier, view: "phone", cpu: 4, scenes: [base] });
  // ---- the curves: animals (at a spring dusk, when the most are about), the land's reach, the plants ----
  for (const tier of TIERS) {
    for (const k of [1, 4, 16, 64, 256]) out.push({ id: `animals.${tier}.x${k}`, series: `animals.${tier}`, tier, view: SCREEN[tier], animals: k, season: "spring", scenes: [dusk] });
    for (const k of [1, 2, 3]) out.push({ id: `reach.${tier}.x${k}`, series: `reach.${tier}`, tier, view: SCREEN[tier], reach: k, scenes: [base] });
    for (const k of [1, 4, 8]) out.push({ id: `plants.${tier}.x${k}`, series: `plants.${tier}`, tier, view: SCREEN[tier], plants: k, scenes: [base] });
  }
  // ---- who else is there, his eyes, the sound ----
  for (const tier of ["high", "medium"] as const) out.push({ id: `company.${tier}`, tier, view: SCREEN[tier], scenes: [company, experiments(4, 12), experiments(12, 12)] });
  for (const [tier, webgl] of [["high", false], ["medium", false], ["low", false], ["high", true], ["low", true]] as const) out.push({ id: `eyes.${tier}.${webgl ? "webgl2" : "webgpu"}`, tier, webgl, view: SCREEN[tier], scenes: eyesScenes });
  out.push({ id: "sound.high.on", tier: "high", view: "desktop", sound: true, weather: "rain", life: "walk", scenes: [{ id: "walk-rain-sound", page: follow, settle: 8 }] });
  out.push({ id: "sound.high.off", tier: "high", view: "desktop", weather: "rain", life: "walk", scenes: [{ id: "walk-rain-silent", page: follow, settle: 8 }] });
  // ---- his whole day ----
  for (const tier of ["high", "medium"] as const) out.push({ id: `day.${tier}`, tier, view: SCREEN[tier], life: "sleep", scenes: hisDay() });
  return out;
}

// ---------- the node, the browser ----------

const median = (values: number[]): number => {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v.length % 2 ? v[v.length >> 1]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
};
const halfRange = (values: number[]): number => (values.length ? (Math.max(...values) - Math.min(...values)) / 2 : 0);
const round = (v: number, digits = 3): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};
const scaleSpread = (s: Spread, k: number): Spread => ({ n: s.n, mean: s.mean * k, p50: s.p50 * k, p95: s.p95 * k, p99: s.p99 * k, max: s.max * k });
/** A window's CPU-clock times at the machine's best speed (`q`: how quiet it was, 0..1); its counts of slow frames can't be scaled and aren't. */
const scaled = (w: FrameStats, q: number): FrameStats => ({ ...w, interval: scaleSpread(w.interval, q), work: scaleSpread(w.work, q), growing: scaleSpread(w.growing, q), parts: Object.fromEntries(Object.entries(w.parts).map(([k, v]) => [k, v * q])), worst: { flags: w.worst.flags, parts: Object.fromEntries(Object.entries(w.worst.parts).map(([k, v]) => [k, v * q])) } });
const medianSpread = (list: Spread[]): Spread => ({ n: Math.round(median(list.map((s) => s.n))), mean: round(median(list.map((s) => s.mean))), p50: round(median(list.map((s) => s.p50))), p95: round(median(list.map((s) => s.p95))), p99: round(median(list.map((s) => s.p99))), max: round(Math.max(...list.map((s) => s.max))) });

const freePort = (): number => {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const p = s.port!;
  s.stop(true);
  return p;
};

const selected = loads().filter((l) => !ONLY || ONLY.test(l.id));
// (`--looks`: the view put at each place named, as one more scene of every load.)
for (const look of (flag("looks") ?? "").split(";").filter(Boolean)) {
  const [name, at] = look.split(":");
  const [lx, ly, distance, yaw] = (at ?? "").split(",").map(Number);
  if (name && Number.isFinite(lx) && Number.isFinite(ly)) for (const load of selected) load.scenes = [...load.scenes, { id: `look-${name}`, page: `(${B}.time("day"), globalThis.__sandboxLook(${lx}, ${ly}, ${distance || 12}, ${yaw || 0}))`, settle: 3 }];
}
if (!selected.length) {
  console.error("no load matches");
  process.exit(1);
}
console.log(`world-scale: ${selected.length} loads, ${selected.reduce((n, l) => n + l.scenes.length, 0)} scenes, ${WINDOWS} windows of ${SECONDS} s each${CAPPED ? " (capped at the display's rate)" : ""}`);

// The machine, by the node's own kernel: the best of three.
let calibration = 0;
for (let i = 0; i < 3; i++) calibration = Math.max(calibration, kernel(400));
/** The best the kernel has ever done on this machine, and the page's own loop (kept beside the results): what "quiet" is measured against. */
const BEST = join(dirname(OUT), "world-scale.machine.json");
let best = calibration;
let bestPage = 0;
try {
  const kept = JSON.parse(readFileSync(BEST, "utf8")) as { name: string; best: number; page?: number };
  if (kept.name === os.hostname() && Number.isFinite(kept.best)) best = Math.max(best, kept.best);
  if (kept.name === os.hostname() && Number.isFinite(kept.page)) bestPage = kept.page!;
} catch {
  /* none kept yet */
}
const keepBest = (): void => {
  try {
    mkdirSync(dirname(BEST), { recursive: true });
    writeFileSync(BEST, `${JSON.stringify({ name: os.hostname(), best: Math.round(best), page: Math.round(bestPage) })}\n`);
  } catch {
    /* it's remembered for this run */
  }
};
const quietNow = (): number => {
  const k = kernel(120);
  if (k > best) {
    best = k;
    keepBest();
  }
  return k / best;
};
quietNow();
/**
 * The page's own loop: a fixed mix of integer and floating-point work on the page's main thread for `ms`, in rounds
 * a millisecond. It's the thread whose frames are measured, so it's slowed exactly as they are.
 */
const PAGE_KERNEL = `(globalThis.__benchKernel ??= (ms) => { const a = new Float64Array(2048); let x = 1, h = 0, n = 0; const from = performance.now(); let now = from; do { for (let i = 0; i < 2048; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; h = (Math.imul(h ^ x, 0x01000193) + i) | 0; a[i] = a[(i * 7 + 1) & 2047] * 1.0000001 + Math.sqrt((h >>> 8) + 1); } n++; now = performance.now(); } while (now - from < ms); return n / (now - from); })`;
/** Waits for a quiet machine (the kernel at QUIET of its best), at most PATIENCE seconds; how quiet it was when it stopped waiting. */
const waitQuiet = async (): Promise<number> => {
  const until = Date.now() + PATIENCE * 1000;
  for (;;) {
    const q = quietNow();
    if (q >= QUIET || Date.now() >= until) return q;
    await Bun.sleep(4000);
  }
};

const root = mkdtempSync(join(os.tmpdir(), "galahad-world-scale-"));
const home = new Home(join(root, "node"));
const port = freePort();
const proxyPort = freePort();
const { identity, keystore } = await home.createIdentity("file");
const store = new MindStore(home.mindPath);
const fleet = foundFleet(store, identity, { fleetName: "bench", nodeName: "bench" });
store.close();
home.writeConfig({ v: 1, name: "bench", fleet, port, keystore, advertise: "127.0.0.1" });
const caps = { os: "linux", arch: "x64", hostname: "bench", cores: 8, cpu: "bench", memoryGb: 16, hasBattery: false, gpu: [], docker: false, vm: { kvm: false, tools: [] }, tools: [], localModels: [], tailscale: null };
const daemon = await startDaemon(home, { capabilities: caps as never, proxyPort, log: () => {}, loopIntervalMs: 3_600_000, defaultHeartbeat: false, weather: false, archiveIntervalMs: false });
const admin = async (name: string, input?: unknown): Promise<any> => {
  const route = (routes as Record<string, { method: string; path: string }>)[name]!;
  const r = await fetch(`http://127.0.0.1:${port}${route.path}`, { method: route.method, headers: { authorization: `Bearer ${home.adminToken()}`, "content-type": "application/json" }, body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined });
  const body = await r.json();
  if (!r.ok) throw new Error(`${name}: ${r.status} ${JSON.stringify(body)}`);
  return body;
};

/** A scene as it was measured: its windows unscaled, and how fast the page's own loop ran round each (rounds a millisecond). */
interface Taken {
  /** Everything of the result that isn't a time on the CPU's clock. */
  fixed: Omit<Result, "cost" | "frames" | "fps" | "work" | "interval" | "gpu" | "growing" | "parts" | "worst" | "quiet" | "raw" | "over16" | "over33" | "over50" | "spread" | "timing">;
  windows: FrameStats[];
  speeds: number[];
  cost?: Result["cost"];
  /** The load's own times (ms from navigation) and the frames that grew land on the way, with the loop's speed just after. */
  timing?: { init: number; compiled: number; first: number; settled: number; hitches: Spread; worst: Record<string, number>; slow: FrameStats["slow"]; speed: number };
}
const taken: Taken[] = [];
/** A measured scene as a result: its CPU-clock times scaled, window by window, to the best the page's loop has done on this machine. */
function build(t: Taken): Result {
  const q = t.speeds.map((k) => (bestPage > 0 && k > 0 ? Math.min(1, k / bestPage) : 1));
  const windows = t.windows.map((w, i) => scaled(w, q[i]!));
  const worstOf = windows.reduce((a, b) => (b.work.max > a.work.max ? b : a));
  const parts: Record<string, number> = {};
  for (const key of Object.keys(windows[0]!.parts)) parts[key] = round(median(windows.map((w) => w.parts[key]!)), 4);
  const lq = t.timing && bestPage > 0 && t.timing.speed > 0 ? Math.min(1, t.timing.speed / bestPage) : 1;
  return {
    ...t.fixed,
    ...(t.cost ? { cost: t.cost } : {}),
    frames: median(windows.map((w) => w.frames)),
    fps: round(median(windows.map((w) => (w.interval.mean > 0 ? 1000 / w.interval.mean : 0))), 1),
    work: medianSpread(windows.map((w) => w.work)),
    interval: medianSpread(windows.map((w) => w.interval)),
    gpu: medianSpread(windows.map((w) => w.gpu)),
    growing: medianSpread(windows.map((w) => w.growing)),
    parts,
    worst: { parts: Object.fromEntries(Object.entries(worstOf.worst.parts).map(([k, v]) => [k, round(v, 2)])), flags: worstOf.worst.flags },
    quiet: round(Math.min(...q), 3),
    raw: { work95: round(median(t.windows.map((w) => w.work.p95))), interval95: round(median(t.windows.map((w) => w.interval.p95))) },
    over16: round(median(windows.map((w) => (1000 * w.over16) / Math.max(1, w.frames))), 2),
    over33: round(median(windows.map((w) => (1000 * w.over33) / Math.max(1, w.frames))), 2),
    over50: round(median(windows.map((w) => (1000 * w.over50) / Math.max(1, w.frames))), 2),
    spread: { work95: round(halfRange(windows.map((w) => w.work.p95))), interval95: round(halfRange(windows.map((w) => w.interval.p95))), gpu50: round(halfRange(windows.map((w) => w.gpu.p50))) },
    ...(t.timing ? { timing: { init: round(t.timing.init * lq, 0), compiled: round(t.timing.compiled * lq, 0), first: round(t.timing.first * lq, 0), settled: round(t.timing.settled * lq, 0), hitches: scaleSpread(t.timing.hitches, lq), worst: Object.fromEntries(Object.entries(t.timing.worst).map(([k, v]) => [k, round(v * lq, 1)])), slow: t.timing.slow.map((f) => ({ ...f, at: round(f.at * lq, 0), ms: round(f.ms * lq, 0), partMs: round(f.partMs * lq, 0) })) } } : {}),
  };
}
let results: Result[] = [];
const problems: string[] = [];
let bundle: { raw: number; gzip: number; brotli: number } | null = null;
let browserPid = 0;
const startedAt = Date.now();

try {
  // The bundle, as the node serves it.
  const sizeOf = async (encoding: string): Promise<number> => {
    const r = await fetch(`http://127.0.0.1:${proxyPort}/world.js`, { headers: { "accept-encoding": encoding }, decompress: false } as RequestInit);
    return (await r.arrayBuffer()).byteLength;
  };
  bundle = { raw: await sizeOf("identity"), gzip: await sizeOf("gzip"), brotli: await sizeOf("br") };

  const invite = await admin("createInvite", { kind: "client", origin: `http://127.0.0.1:${proxyPort}` });
  const cdpPort = 9400 + Math.floor(Math.random() * 500);
  const flags = [
    "--headless=new",
    "--no-first-run",
    "--disable-extensions",
    "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--enable-precise-memory-info",
    // Timestamp queries as the GPU counts them (otherwise rounded to a tenth of a millisecond).
    "--enable-webgpu-developer-features",
    // Every frame the pipeline can make, not the display's sixty.
    ...(CAPPED ? [] : ["--disable-frame-rate-limit", "--disable-gpu-vsync"]),
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${join(root, "profile")}`,
    "about:blank",
  ];
  const browser = Bun.spawn([EDGE, ...flags], { stdout: "ignore", stderr: "ignore" });
  browserPid = browser.pid;
  let browserWs = "";
  try {
    let wsUrl = "";
    for (let i = 0; i < 80 && !wsUrl; i++) {
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
      } catch {}
      if (!wsUrl) await Bun.sleep(250);
    }
    if (!wsUrl) throw new Error("the browser never came up");
    browserWs = ((await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
    const connect = async (url: string) => {
      const ws = new WebSocket(url);
      await new Promise((r) => ws.addEventListener("open", r, { once: true }));
      let next = 0;
      const pending = new Map<number, (m: any) => void>();
      const listeners: ((m: any) => void)[] = [];
      ws.addEventListener("message", (event) => {
        const m = JSON.parse(String(event.data));
        if (m.id && pending.has(m.id)) {
          pending.get(m.id)!(m);
          pending.delete(m.id);
        } else for (const l of listeners) l(m);
      });
      // (A page asked for more than it can carry may never answer: after three quarters of a minute the question is dropped.)
      const send = (method: string, params: object = {}): Promise<any> =>
        new Promise((resolve) => {
          const id = ++next;
          const timer = setTimeout(() => {
            if (pending.delete(id)) resolve({ timedOut: true });
          }, 45_000);
          pending.set(id, (m) => {
            clearTimeout(timer);
            resolve(m);
          });
          ws.send(JSON.stringify({ id, method, params }));
        });
      return { ws, send, listeners };
    };
    const page = await connect(wsUrl);
    const whole = await connect(browserWs);
    const send = page.send;
    let counting = false;
    let current = "";
    page.listeners.push((m) => {
      if (!counting) return;
      if (m.method === "Runtime.exceptionThrown") problems.push(`${current}: exception ${JSON.stringify(m.params.exceptionDetails).slice(0, 300)}`);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push(`${current}: console ${JSON.stringify(m.params.args).slice(0, 300)}`);
    });
    const evaluate = async (expression: string): Promise<any> => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) problems.push(`${current}: evaluate ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`);
      return r.result?.result?.value;
    };
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Performance.enable");
    await send("HeapProfiler.enable");

    // Paired as a client, once.
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: invite.url });
    await Bun.sleep(3000);
    await evaluate("(() => { const b = [...document.querySelectorAll('button')].find((x) => /ask to join/i.test(x.textContent || '')); if (b) b.click(); })()");
    let approved = false;
    for (let i = 0; i < 80 && !approved; i++) {
      const { pairings } = await admin("pairings");
      if (pairings.length) {
        await admin("approvePairing", { invite: pairings[0].invite, device: pairings[0].device });
        approved = true;
      } else await Bun.sleep(250);
    }
    if (!approved) throw new Error("the browser never asked to pair");
    await Bun.sleep(3000);

    /** The GPU process's dedicated memory, as Windows counts it (MB); null where it can't be asked. */
    const gpuMemory = async (): Promise<number | null> => {
      try {
        const info = await whole.send("SystemInfo.getProcessInfo");
        const gpu = (info.result?.processInfo as { type: string; id: number }[] | undefined)?.find((p) => p.type === "GPU");
        if (!gpu) return null;
        const ps = Bun.spawnSync(["powershell", "-NoProfile", "-Command", `(Get-Counter -Counter '\\GPU Process Memory(pid_${gpu.id}_*)\\Dedicated Usage' -ErrorAction Stop).CounterSamples | Measure-Object CookedValue -Sum | ForEach-Object { $_.Sum }`], { stdout: "pipe", stderr: "ignore" });
        const bytes = Number(new TextDecoder().decode(ps.stdout).trim().replace(",", "."));
        return Number.isFinite(bytes) && bytes > 0 ? round(bytes / 2 ** 20, 1) : null;
      } catch {
        return null;
      }
    };
    const heap = async (): Promise<number> => {
      await send("HeapProfiler.collectGarbage");
      const m = await send("Performance.getMetrics");
      const used = (m.result?.metrics as { name: string; value: number }[] | undefined)?.find((x) => x.name === "JSHeapUsedSize")?.value ?? 0;
      return round(used / 2 ** 20, 1);
    };
    /** Where the main thread's time goes, by function: a sampled profile, each sample given to the nearest caller that names a part of the work. */
    const profile = async (seconds: number): Promise<Record<string, number>> => {
      await send("Profiler.enable");
      await send("Profiler.setSamplingInterval", { interval: 200 });
      await send("Profiler.start");
      await Bun.sleep(seconds * 1000);
      const stopped = await send("Profiler.stop");
      await send("Profiler.disable");
      const p = stopped.result?.profile as { nodes: { id: number; callFrame: { functionName: string; url: string }; children?: number[] }[]; samples: number[]; timeDeltas: number[] } | undefined;
      if (!p) return {};
      const parent = new Map<number, number>();
      const byId = new Map<number, (typeof p.nodes)[number]>();
      for (const n of p.nodes) {
        byId.set(n.id, n);
        for (const c of n.children ?? []) parent.set(c, n.id);
      }
      const workOf = new Map<number, string>();
      const work = (id: number): string => {
        const known = workOf.get(id);
        if (known) return known;
        const name = byId.get(id)!.callFrame.functionName;
        let bucket = WORK.find(([, re]) => re.test(name))?.[0] ?? "";
        if (!bucket) {
          const up = parent.get(id);
          bucket = up === undefined ? "the world's own code" : work(up);
        }
        workOf.set(id, bucket);
        return bucket;
      };
      const passOf = new Map<number, string>();
      const pass = (id: number): string => {
        const known = passOf.get(id);
        if (known) return known;
        const name = byId.get(id)!.callFrame.functionName;
        const up = parent.get(id);
        const above = up === undefined ? "outside the renderer" : pass(up);
        const bucket = above === "the shadow pass" || SHADOW.test(name) ? "the shadow pass" : above === "the scene's passes" || RENDER.test(name) ? "the scene's passes" : "outside the renderer";
        passOf.set(id, bucket);
        return bucket;
      };
      const out: Record<string, number> = {};
      const passes: Record<string, number> = {};
      let total = 0;
      // (`--profile-raw=<file>`: every function's own time and who called it, to see what the buckets should be.)
      const rawTo = flag("profile-raw");
      if (rawTo) {
        const self = new Map<string, number>();
        p.samples.forEach((id, i) => {
          const chain: string[] = [];
          for (let at: number | undefined = id; at !== undefined && chain.length < 7; at = parent.get(at)) chain.push(byId.get(at)!.callFrame.functionName || "(anonymous)");
          const key = chain.join(" < ");
          self.set(key, (self.get(key) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
        });
        writeFileSync(rawTo, [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400).map(([k, v]) => `${v.toFixed(1)} ms  ${k}`).join("\n"));
      }
      p.samples.forEach((id, i) => {
        const ms = (p.timeDeltas[i] ?? 0) / 1000;
        const bucket = work(id);
        out[bucket] = (out[bucket] ?? 0) + ms;
        if (bucket !== "idle") passes[pass(id)] = (passes[pass(id)] ?? 0) + ms;
        total += ms;
      });
      // As shares of the time the main thread wasn't idle.
      const busy = total - (out.idle ?? 0);
      const shares: Record<string, number> = { "busy share of the time": round(busy / Math.max(1e-9, total), 3) };
      for (const [k, v] of Object.entries(out)) if (k !== "idle") shares[k] = round(v / Math.max(1e-9, busy), 4);
      for (const [k, v] of Object.entries(passes)) shares[`in ${k}`] = round(v / Math.max(1e-9, busy), 4);
      return shares;
    };

    /**
     * This browser's own processes (and this one) ahead of whatever else the machine is doing: a shared machine's
     * other work then takes what's left, instead of a share of what's being measured. Only these processes, by pid.
     */
    let raised = 0;
    const raise = async (): Promise<void> => {
      try {
        const info = await whole.send("SystemInfo.getProcessInfo");
        const ids = ((info.result?.processInfo as { id: number }[] | undefined) ?? []).map((p) => p.id);
        let done = 0;
        for (const pid of [process.pid, ...ids]) {
          try {
            os.setPriority(pid, os.constants.priority.PRIORITY_HIGH);
            done++;
          } catch {
            /* not allowed for this one: it runs at the priority it has */
          }
        }
        if (done !== raised) console.log(`  (priority raised for ${done} of this run's ${ids.length + 1} processes)`);
        raised = done;
      } catch {
        /* the browser didn't say: nothing is raised */
      }
    };
    const ctx: Ctx = { daemon, evaluate };
    let n = 0;
    /** The curves that broke (under fifteen frames a second, or a page that never settled), and where: four times as much again would only take minutes to say the same. */
    const broken = new Map<string, string>();
    for (const load of selected) {
      current = load.id;
      const began = Date.now();
      if (load.series && broken.has(load.series)) {
        problems.push(`${load.id}: not tried (${broken.get(load.series)} broke)`);
        console.log(`  ${load.id}: not tried (${broken.get(load.series)} broke)`);
        continue;
      }
      const view = VIEWS[load.view];
      for (const t of timers.splice(0)) clearInterval(t);
      daemon.world.rest(0);
      counting = false;
      await send("Page.navigate", { url: "about:blank" });
      await send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await send("Emulation.setDeviceMetricsOverride", { width: view.width, height: view.height, deviceScaleFactor: view.dpr, mobile: view.mobile });
      await send("Emulation.setTouchEmulationEnabled", { enabled: view.mobile });
      // What this viewer chose last time, as the page keeps it: the season, the weather, the panels, the sound.
      const kept: Record<string, string> = { "galahad.world.season": flag("season") ?? load.season ?? "summer", "galahad.world.weather": load.weather ?? "clear", "galahad.world.map": "off", "galahad.world.eyes": load.eyes ? "on" : "off", "galahad.world.sound": load.sound ? "on" : "off", "galahad.world.seen": String(Date.now()) };
      const init = await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { for (const [k, v] of Object.entries(${JSON.stringify(kept)})) localStorage.setItem(k, v); } catch {}` });
      const query = new URLSearchParams({ trace: "1", tier: load.tier, hold: "1", gpu: "1", life: load.life ?? "ponder" });
      if (!CAPPED) query.set("uncap", "1");
      if (load.webgl) query.set("webgl", "1");
      if (load.animals) query.set("animals", String(load.animals));
      if (load.reach) query.set("reach", String(load.reach));
      if (load.plants) query.set("plants", String(load.plants));
      await send("Page.navigate", { url: `http://127.0.0.1:${proxyPort}/?${query}#/world` });
      counting = true;
      // (`--profile-load`: where the main thread's time goes while the world loads, by function and caller.)
      const loadProfile = flag("profile-load");
      if (loadProfile) {
        await send("Profiler.enable");
        await send("Profiler.setSamplingInterval", { interval: 500 });
        await send("Profiler.start");
        await Bun.sleep(14_000);
        const stopped = await send("Profiler.stop");
        await send("Profiler.disable");
        const prof = stopped.result?.profile as { nodes: { id: number; callFrame: { functionName: string }; children?: number[] }[]; samples: number[]; timeDeltas: number[] } | undefined;
        if (prof) {
          const parent = new Map<number, number>();
          const byId = new Map<number, (typeof prof.nodes)[number]>();
          for (const node of prof.nodes) {
            byId.set(node.id, node);
            for (const c of node.children ?? []) parent.set(c, node.id);
          }
          const self = new Map<string, number>();
          prof.samples.forEach((id, i) => {
            const chain: string[] = [];
            for (let at: number | undefined = id; at !== undefined && chain.length < 9; at = parent.get(at)) chain.push(byId.get(at)!.callFrame.functionName || "(anonymous)");
            const key = chain.join(" < ");
            self.set(key, (self.get(key) ?? 0) + (prof.timeDeltas[i] ?? 0) / 1000);
          });
          writeFileSync(`${loadProfile}.${load.id}.txt`, [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([k, v]) => `${v.toFixed(1)} ms  ${k}`).join(String.fromCharCode(10)));
        }
      }
      // Until nothing's left to grow (or it never settles: said, and measured as it is).
      let timing: { mount: number; init: number; compiled: number; first: number; settled: number } | null = null;
      let alive = false;
      const patience = Date.now() + 120_000;
      for (let i = 0; i < 600 && Date.now() < patience; i++) {
        await Bun.sleep(200);
        const t = await evaluate(`(() => { const b = ${B}; if (!b) return null; b.always = true; return b.timing; })()`);
        if (t) alive = true;
        if (t?.settled) {
          timing = t;
          break;
        }
      }
      await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: init.result?.identifier });
      if (!alive) {
        problems.push(`${load.id}: the world never mounted`);
        console.log(`  ${load.id}: the world never mounted (skipped)`);
        if (load.series) broken.set(load.series, load.id);
        continue;
      }
      if (!timing) {
        problems.push(`${load.id}: never settled within two minutes`);
        if (load.series) broken.set(load.series, load.id);
      }
      await raise();
      await evaluate(`${PAGE_KERNEL}(30)`);
      /** How fast the page's own loop runs now (rounds a millisecond; a slowed CPU is allowed for): the best it has ever done here is what "quiet" is. */
      const pageSpeed = async (): Promise<number> => {
        const k = Number(await evaluate(`Math.max(${PAGE_KERNEL}(25), ${PAGE_KERNEL}(25), ${PAGE_KERNEL}(25))`)) * (throttled ? (load.cpu ?? 1) : 1);
        if (!(k > 0)) return 0;
        if (k > bestPage) {
          bestPage = k;
          keepBest();
        }
        return k;
      };
      let throttled = false;
      const loadSpeed = await pageSpeed();
      // (A few seconds more: what arrives after the world has settled, the robots' models for one, is part of the load.)
      await Bun.sleep(3000);
      const loaded = (await evaluate(`${B}.stats()`)) as FrameStats;
      const hitches = loaded.growing;
      const backend = String(await evaluate(`${B}.backend`));
      if (load.sound) {
        // A real key, so the browser lets the sound start.
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftLeft" });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft" });
      }
      if (load.cpu) {
        await send("Emulation.setCPUThrottlingRate", { rate: load.cpu });
        throttled = true;
      }
      let first = true;
      for (const scene of load.scenes) {
        const id = `${load.id}.${scene.id}`;
        current = id;
        if (scene.node) await scene.node(ctx);
        if (scene.page) await evaluate(scene.page);
        await Bun.sleep((scene.settle ?? 2.5) * 1000);
        // Until the land the view now asks for has grown (a flight is measured while it grows).
        if (!scene.fly) {
          for (let i = 0; i < 100; i++) {
            await evaluate(`${B}.reset()`);
            await Bun.sleep(500);
            const s = (await evaluate(`${B}.stats()`)) as FrameStats;
            if (s.frames > 5 && s.growing.n === 0) break;
          }
        }
        const windows: FrameStats[] = [];
        const speeds: number[] = [];
        await waitQuiet();
        let around = await pageSpeed();
        // A part's cost: without it and with it, turn about, each pair seconds apart.
        let cost: Result["cost"];
        if (scene.part) {
          const pairs: { cpu: number; render: number; gpu: number; calls: number; objects: number; triangles: number }[] = [];
          const one = async (page: string): Promise<{ stats: FrameStats; drawn: Drawn; q: number; speed: number }> => {
            await evaluate(page);
            await Bun.sleep(500);
            await evaluate(`${B}.reset()`);
            await Bun.sleep(PAIR_SECONDS * 1000);
            const stats = (await evaluate(`${B}.stats()`)) as FrameStats;
            const drawn = (await evaluate(`${B}.drawn()`)) as Drawn;
            const after = await pageSpeed();
            const speed = (around + after) / 2;
            const q = bestPage > 0 ? Math.min(1, speed / bestPage) : 1;
            around = after;
            return { stats, drawn, q, speed };
          };
          for (let i = 0; i < PAIRS; i++) {
            // (Which comes first alternates, so a machine getting busier or quieter doesn't lean on one side.)
            let without: Awaited<ReturnType<typeof one>>;
            let whole: Awaited<ReturnType<typeof one>>;
            if (i % 2) {
              whole = await one(scene.part.back);
              without = await one(scene.part.without);
            } else {
              without = await one(scene.part.without);
              whole = await one(scene.part.back);
            }
            windows.push(whole.stats);
            speeds.push(whole.speed);
            pairs.push({ cpu: whole.stats.work.p50 * whole.q - without.stats.work.p50 * without.q, render: whole.stats.parts.render! * whole.q - without.stats.parts.render! * without.q, gpu: whole.stats.gpu.p50 - without.stats.gpu.p50, calls: whole.drawn.calls - without.drawn.calls, objects: whole.drawn.objects - without.drawn.objects, triangles: whole.drawn.triangles - without.drawn.triangles });
          }
          await evaluate(scene.part.back);
          cost = { pairs: pairs.length, cpu: round(median(pairs.map((x) => x.cpu))), cpuSpread: round(halfRange(pairs.map((x) => x.cpu))), render: round(median(pairs.map((x) => x.render))), gpu: round(median(pairs.map((x) => x.gpu))), calls: Math.round(median(pairs.map((x) => x.calls))), objects: Math.round(median(pairs.map((x) => x.objects))), triangles: Math.round(median(pairs.map((x) => x.triangles))) };
        }
        for (let w = 0; w < (scene.part ? 0 : WINDOWS); w++) {
          // (A flight goes on over country it hasn't flown yet.)
          if (scene.fly) await evaluate(`(() => { const at = performance.now(); const y0 = 10 + ${w} * ${scene.fly * SECONDS}; globalThis.__flight && clearInterval(globalThis.__flight); globalThis.__flight = setInterval(() => globalThis.__sandboxLook(0, y0 + (performance.now() - at) / 1000 * ${scene.fly}, 60, Math.PI / 2), 16); })()`);
          await evaluate(`${B}.reset()`);
          await Bun.sleep(SECONDS * 1000);
          windows.push((await evaluate(`${B}.stats()`)) as FrameStats);
          // How fast the page's own thread was round this window.
          const after = await pageSpeed();
          speeds.push((around + after) / 2);
          around = after;
        }
        if (scene.fly) await evaluate("clearInterval(globalThis.__flight)");
        const drawn = (await evaluate(`${B}.drawn()`)) as Drawn;
        if (!drawn.calls) problems.push(`${id}: no draw calls counted`);
        const buffers = (await evaluate(`${B}.memory()`)) as { bytes: number; buffers: number };
        const shares = PROFILE && scene.profile ? await profile(4) : undefined;
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true });
          const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          if (shot.result?.data) writeFileSync(join(SHOTS, `${id}.png`), Buffer.from(shot.result.data, "base64"));
        }
        const kept: Taken = {
          fixed: {
            id,
            load: load.id,
            scene: scene.id,
            tier: load.tier,
            backend,
            view: load.view,
            animals: load.animals ?? 1,
            reach: load.reach ?? 1,
            plants: load.plants ?? 1,
            cpu: load.cpu ?? 1,
            windows: windows.length,
            drawn,
            megapixels: round((drawn.width * drawn.height) / 1e6, 3),
            heapMb: await heap(),
            buffersMb: round(buffers.bytes / 2 ** 20, 1),
            gpuMb: first || scene.fly ? await gpuMemory() : null,
            ...(shares ? { profile: shares } : {}),
          },
          ...(cost ? { cost } : {}),
          windows,
          speeds,
          ...(first && timing ? { timing: { init: timing.init, compiled: timing.compiled, first: timing.first, settled: timing.settled, hitches, worst: loaded.worst.parts, slow: loaded.slow, speed: loadSpeed } } : {}),
        };
        taken.push(kept);
        const result = build(kept);
        first = false;
        if (load.series && result.raw.interval95 > BROKEN_MS) broken.set(load.series, load.id);
        console.log(
          `  ${id}: cpu ${result.work.p50.toFixed(2)} / ${result.work.p95.toFixed(2)} / ${result.work.max.toFixed(1)} ms (p50/p95/max), gpu ${result.gpu.p50.toFixed(2)} ms, frame ${result.interval.p50.toFixed(2)} / ${result.interval.p95.toFixed(2)} ms, ${drawn.calls} calls, ${drawn.objects} objects, ${(drawn.triangles / 1e6).toFixed(2)} M tris${result.cost ? `, the part costs ${result.cost.cpu.toFixed(2)} ± ${result.cost.cpuSpread.toFixed(2)} ms of CPU, ${result.cost.gpu.toFixed(2)} ms of GPU, ${result.cost.objects} objects, ${result.cost.calls} calls` : ""}, ${drawn.animals} animals, ${drawn.chunks} chunks, ${result.megapixels} MP, quiet ${result.quiet.toFixed(2)}${result.timing ? `, first frame ${result.timing.first} ms, settled ${result.timing.settled} ms${result.timing.slow.length ? `, slow frames while loading: ${result.timing.slow.map((f) => `${f.ms} ms at ${f.at} (${f.part})`).join(", ")}` : ""}` : ""}`,
        );
        if (scene.after) await evaluate(scene.after);
      }
      n++;
      console.log(`  (${n}/${selected.length} loads, ${Math.round((Date.now() - began) / 1000)} s; ${Math.round((Date.now() - startedAt) / 60000)} min so far)`);
      writeOut();
    }
    page.ws.close();
    whole.ws.close();
  } finally {
    try {
      const b = new WebSocket(browserWs);
      await new Promise((resolve) => b.addEventListener("open", resolve, { once: true }));
      b.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      await Bun.sleep(1500);
    } catch {}
    // The whole tree, by its own pid: killing only the launcher leaves Edge's children running.
    Bun.spawnSync(["taskkill", "/PID", String(browserPid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
    browser.kill();
    await browser.exited;
  }
} finally {
  for (const t of timers.splice(0)) clearInterval(t);
  await daemon.stop();
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(root, { recursive: true, force: true });
      break;
    } catch {
      await Bun.sleep(1000);
    }
  }
}
writeOut();
const loud = results.filter((r) => r.quiet < QUIET);
console.log(`world-scale: ${results.length} scenes measured in ${Math.round((Date.now() - startedAt) / 60000)} min; ${problems.length} problem(s); ${loud.length} measured on a busy machine and scaled${loud.length ? ` (${loud.slice(0, 6).map((r) => `${r.id} at ${r.quiet}`).join(", ")}${loud.length > 6 ? ", …" : ""})` : ""}`);
for (const p of problems.slice(0, 20)) console.log(`  ! ${p}`);
console.log(`  ${OUT}`);
process.exit(0);

// ---------- what's written ----------

interface Metric {
  id: string;
  value: number;
  unit: string;
  kind: "quality" | "speed";
  better: "higher" | "lower";
  spread?: number;
  n?: number;
  note?: string;
}

/** Where along a curve (x rising) a value first passes `limit`: between two measured points, in proportion (on a log scale of x); null if it never does, the first x if it already has. */
function crossing(points: { x: number; y: number }[], limit: number): { x: number; beyond: boolean } | null {
  const p = [...points].sort((a, b) => a.x - b.x);
  if (!p.length) return null;
  if (p[0]!.y > limit) return { x: p[0]!.x, beyond: false };
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    if (b.y <= limit) continue;
    const t = (limit - a.y) / (b.y - a.y);
    return { x: Math.exp(Math.log(a.x) + t * (Math.log(b.x) - Math.log(a.x))), beyond: false };
  }
  return { x: p[p.length - 1]!.x, beyond: true };
}

function writeOut(): void {
  // (Built again each time: the best the page's loop has done may have risen since a scene was measured.)
  results = taken.map(build);
  const metrics: Metric[] = [];
  const add = (id: string, value: number, unit: string, better: Metric["better"], extra: Partial<Metric> = {}): void => void (Number.isFinite(value) && metrics.push({ id, value: round(value), unit, kind: "speed", better, ...extra }));
  for (const r of results) {
    const n = r.windows;
    add(`${r.id}.cpu.p50`, r.work.p50, "ms", "lower", { n });
    add(`${r.id}.cpu.p95`, r.work.p95, "ms", "lower", { n, spread: r.spread.work95 });
    add(`${r.id}.cpu.p99`, r.work.p99, "ms", "lower", { n });
    add(`${r.id}.cpu.max`, r.work.max, "ms", "lower", { n, note: "the longest frame on the main thread in any window" });
    if (r.gpu.n) add(`${r.id}.gpu.p50`, r.gpu.p50, "ms", "lower", { n, spread: r.spread.gpu50, note: "WebGPU timestamp queries over a frame's render passes" });
    if (!CAPPED) add(`${r.id}.frame.p95`, r.interval.p95, "ms", "lower", { n, spread: r.spread.interval95, note: "the interval between frames with the browser's frame-rate limit off" });
    add(`${r.id}.calls`, r.drawn.calls, "draw calls", "lower");
    add(`${r.id}.objects`, r.drawn.objects, "objects", "lower", { note: "what the renderer is handed a frame, all passes" });
    if (r.cost) add(`${r.id}.cpu`, r.cost.cpu, "ms", "lower", { n: r.cost.pairs, spread: r.cost.cpuSpread, note: "the main thread's time with the part less without it, in pairs seconds apart" });
    add(`${r.id}.triangles`, r.drawn.triangles, "triangles", "lower");
    add(`${r.id}.heap`, r.heapMb, "MB", "lower");
    if (r.gpuMb !== null) add(`${r.id}.gpu-memory`, r.gpuMb, "MB", "lower", { note: "the browser's GPU process, dedicated, as Windows counts it" });
    if (r.timing) {
      add(`${r.load}.first-frame`, r.timing.first, "ms", "lower", { note: "from navigation" });
      add(`${r.load}.settled`, r.timing.settled, "ms", "lower", { note: "from navigation, until nothing was left to grow" });
      add(`${r.load}.load-hitch.max`, r.timing.hitches.max, "ms", "lower", { note: "the longest frame that grew land while loading" });
    }
    if (r.scene === "fly") {
      add(`${r.id}.hitch.p95`, r.growing.p95, "ms", "lower", { n: r.growing.n });
      add(`${r.id}.hitch.max`, r.growing.max, "ms", "lower");
    }
  }
  // The curves: how many animals, how far a view, how many plants before the 95th percentile frame leaves 60 and 30 a second.
  const curves: Record<string, unknown>[] = [];
  for (const tier of TIERS) {
    for (const [axis, key] of [["animals", "animals"], ["reach", "reach"], ["plants", "plants"]] as const) {
      const points = results.filter((r) => r.load.startsWith(`${axis}.${tier}.x`) && r.cpu === 1);
      if (points.length < 2) continue;
      for (const [name, limit] of [["60", 1000 / 60], ["30", 1000 / 30]] as const) {
        for (const [what, y] of [["frame", (r: Result) => r.interval.p95], ["cpu", (r: Result) => r.work.p95]] as const) {
          if (what === "frame" && CAPPED) continue;
          const at = crossing(points.map((r) => ({ x: r[key], y: y(r) })), limit);
          if (!at) continue;
          // In what's really there: the animals alive, the chunks drawn, at the nearest measured point.
          const near = points.reduce((a, b) => (Math.abs(Math.log(b[key] / at.x)) < Math.abs(Math.log(a[key] / at.x)) ? b : a));
          curves.push({ tier, axis, limit: `${name} fps`, by: what, times: round(at.x, 2), beyond: at.beyond, nearest: { times: near[key], animals: near.drawn.animals, chunks: near.drawn.chunks, triangles: near.drawn.triangles } });
          add(`headroom.${tier}.${axis}.${what}${name}`, at.x, "times the tier's", "higher", { note: `${at.beyond ? "at least (never left it in what was measured)" : "where the 95th percentile"} ${what === "frame" ? "frame interval" : "main-thread frame"} ${at.beyond ? "" : "leaves "}${name} fps` });
        }
      }
    }
  }
  if (bundle) {
    add("bundle.world.raw", bundle.raw, "bytes", "lower");
    add("bundle.world.gzip", bundle.gzip, "bytes", "lower");
    add("bundle.world.brotli", bundle.brotli, "bytes", "lower");
  }
  const head = { suite: "world-scale", commit: commit(), at: new Date().toISOString(), seed: SEED, machine: { name: os.hostname(), calibration: Math.round(calibration), cores: os.cpus().length } };
  const noisy = results.filter((r) => r.quiet < QUIET).map((r) => r.id);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ ...head, metrics }, null, 1)}\n`);
  writeFileSync(OUT.replace(/\.json$/, ".raw.json"), `${JSON.stringify({ ...head, mode: FULL ? "full" : "quick", capped: CAPPED, windows: WINDOWS, seconds: SECONDS, bundle, curves, problems, best: Math.round(best), noisy, results }, null, 1)}\n`);
}

function commit(): string {
  try {
    const rev = new TextDecoder().decode(Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: REPO }).stdout).trim();
    const dirty = new TextDecoder().decode(Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=no"], { cwd: REPO }).stdout).trim();
    return rev + (dirty ? "+" : "");
  } catch {
    return "unknown";
  }
}
