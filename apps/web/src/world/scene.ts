import type { SiteName, Station, WorldEvent } from "@galahad/core/world";
import { padAt, SITE_NAMES, SITES, STATIONS } from "@galahad/core/world";
import { AgXToneMapping, Color, DirectionalLight, Group, HemisphereLight, Object3D, PCFShadowMap, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGPURenderer } from "three/webgpu";
import { ENGINE_LABEL, STATUS_LABEL, type WorldModel } from "../lib/world.ts";
import { setWindHeading } from "./air.ts";
import { Atmosphere, HAZE } from "./atmosphere.ts";
import { attachInput, CAMERA_PAD, CameraRig, DEFAULT_DISTANCE, pitchFor, type Point3, SpringArm, STATION_DISTANCE } from "./camera.ts";
import { BUILDS, Solids } from "./collide.ts";
import { headingToSceneYaw, onPlot, type Vec3 } from "./coords.ts";
import { applyWeather, emptyHeavens, emptySky, heavensAt, skyFor, TIME_PRESETS, type TimePreset } from "./daynight.ts";
import { ColliderLines, wantsColliders } from "./debug-colliders.ts";
import { RobotDog } from "./dog.ts";
import { Critters } from "./critters.ts";
import { Fauna } from "./fauna.ts";
import { addPlants } from "./flora-plan.ts";
import { ProvingGround } from "./field.ts";
import { Glows } from "./glows.ts";
import { Workshop } from "./hall.ts";
import { HALL } from "./hall-plan.ts";
import { forgeAnvil, Keep, stationLabelPoint } from "./keep.ts";
import { BEACON_COLLIDERS, fleetColliders, KEEP_COLLIDERS } from "./keep-plan.ts";
import { type Attention, HEAD_HEIGHT, Knight, type KnightState } from "./knight.ts";
import { Land, waterUniforms } from "./land.ts";
import { Lightning } from "./lightning.ts";
import { occlusion } from "./occlusion.ts";
import { readThemeColors } from "./palette.ts";
import { Planner } from "./nav.ts";
import { type Obstacle, obstacles, PLACES, standAt, targetFor, Walker } from "./path.ts";
import type { Ground } from "./physics.ts";
import { BREEZE, type Place, type PlaceContext, type PlaceFrame, WIND_HEADING } from "./place.ts";
import { plotColliders } from "./plot-plan.ts";
import { originUniform, Plots } from "./plots.ts";
import { Assembly, benchFor, buildingAt } from "./assembly.ts";
import { Post } from "./post.ts";
import { Rain } from "./rain.ts";
import { Horizon, Landmarks } from "./scenery.ts";
import { onSite, SITE_COLLIDERS, SITE_VIEW } from "./sites.ts";
import { SkyDome } from "./sky.ts";
import { BASE_FLATS, KEEP_RADIUS, plotFlat, SEED, WATER_LEVEL } from "./terrain.ts";
import { chooseTier, type DeviceInfo, ResolutionGovernor, type Tier, TIERS, type TierName } from "./tiers.ts";
import { Vegetation, wind } from "./vegetation.ts";
import type { WeatherTarget } from "./live-weather.ts";
import { Weather, type WeatherKind } from "./weather.ts";
import { weatherUniforms } from "./wet.ts";

/*
 * The SANDBOX's renderer, on three.js's WebGPU renderer (its WebGL2 backend where
 * WebGPU isn't available): the land and what grows on it, the treehouse keep and
 * its stations, the plots, Galahad and his dog, birds, deer, rabbits, ducks and
 * fireflies, a sky under the real sun and moon over Denmark, weather (cloud,
 * mist, rain, snow, wind, thunder), and HTML labels and a speech bubble projected from 3D. A quality
 * tier chosen at start caps everything; the resolution governor holds the frame
 * time (post effects first, then the pixel ratio, then shadows and grass).
 *
 * The picture: AgX tone mapping (exposure by the sun and the weather) over
 * linear-light colours; a sun and a lavender-and-green hemisphere fill, ambient
 * occlusion baked into the geometry, a grade for the time of day, and the air
 * (atmosphere.ts: a haze that warms towards the sun, a height-bound mist that
 * lies in hollows and over water, cloud shadows, lightning), dithered so their
 * gradients never band; rain and snow, ripples, wet, darker ground and lying
 * snow (wet.ts); on the high tier, GTAO, light shafts marched through the sun's
 * shadow map, and bloom (post.ts, shafts.ts); multisampling where it's
 * cheap; a reversed depth buffer on WebGPU (no flicker far away). Steady: land grows within a time budget per
 * frame, frames are paced to the display (none dropped for a fraction of a
 * millisecond), the camera follows on a smoothed ground, shadows are snapped to
 * their texels, labels are projected after the camera moves and eased onto
 * device pixels. It renders at most 60 frames a second (idle life at 30, less on
 * low tiers), pauses while the page is hidden, allocates nothing per frame in
 * its own code, and gives every GPU resource back when disposed. If the GPU
 * device is lost it says so through `onLost`, and the page decides (a restart,
 * or the text summary).
 */

export type GoTo =
  | { kind: "galahad" }
  | { kind: "station"; station: Exclude<Station, "field"> }
  | { kind: "site"; site: SiteName }
  | { kind: "experiment"; id: string }
  /** A point on the ground (the map): the view moves there, as it is. */
  | { kind: "point"; x: number; y: number };

/** Where Galahad is and where the camera looks (world metres; headings in the atan2 convention): what the map draws. */
export interface WorldWhere {
  galahadX: number;
  galahadY: number;
  galahadHeading: number;
  focusX: number;
  focusY: number;
  /** The way the camera looks, and how far it is from its focus. */
  yaw: number;
  distance: number;
}

export interface WorldOptions {
  /** A plot (or empty ground: null) was tapped. */
  onSelect(id: string | null): void;
  /** Following Galahad turned on or off (panning turns it off). */
  onFollow(on: boolean): void;
  /** The GPU device was lost; the handle is already dead. */
  onLost(reason: string): void;
  /** Start below the detected tier (a restart after a lost device). */
  tier?: TierName;
  /** Use the WebGL2 backend even where WebGPU is available (a restart after the WebGPU device was lost). */
  forceWebGL?: boolean;
  /** The weather at first sight (it's there at once, not eased into). */
  weather?: WeatherKind;
}

export interface WorldStats {
  backend: "webgpu" | "webgl2";
  tier: TierName;
  dpr: number;
  /** Frames rendered in the last second, and their average interval (ms). */
  fps: number;
  frameMs: number;
  drawCalls: number;
  shadows: boolean;
  /** The post effects still on (high tier), e.g. ["ao", "shafts", "bloom"]. */
  effects: string[];
  instances: Record<string, number>;
}

export interface WorldHandle {
  /** The model after an event; `event` is the event that produced it (frames feed the playback buffer). */
  update(model: WorldModel, event: WorldEvent | null): void;
  setFollow(on: boolean): void;
  goTo(target: GoTo): void;
  /** Zoom steps: positive zooms in. */
  zoom(steps: number): void;
  /** Turn steps of 22.5°. */
  rotate(steps: number): void;
  /** Pan by steps along the view (keyboard). */
  pan(right: number, forward: number): void;
  select(id: string | null): void;
  setBeacon(on: boolean): void;
  /** A fixed look (a place of the sun), or null for the real sky over Denmark now. */
  setTimeOfDay(preset: TimePreset | null): void;
  /** The weather to ease towards. */
  setWeather(kind: WeatherKind): void;
  /** The real weather (Denmark's, now) to ease towards, as cloud, rain and mist; `snap` goes straight there (first sight). */
  aimWeather(target: WeatherTarget, snap?: boolean): void;
  stats(): WorldStats;
  /** Where things are now, written into `out` (nothing is allocated). */
  where(out: WorldWhere): WorldWhere;
  dispose(): void;
}

const REBASE_M = 2048;
const ZERO: [number, number] = [0, 0];
/** A frame is due this long after the last (a 60 Hz frame, less a margin so rAF jitter never skips one). */
const FRAME_MIN_MS = 1000 / 60 - 3;
/** The world's exposure under AgX: pastel colours at about the brightness they were painted. */
const EXPOSURE = 1.55;
export { HAZE };
const DEG = 180 / Math.PI;

interface Label {
  el: HTMLElement;
  /** Writes the world point (z up) into `out`; false when there's nothing to show. */
  point: (out: Vec3) => boolean;
  /** Fade out beyond this many camera distances. */
  fade: number;
  /** Eased screen position (CSS px), and the last one written. */
  sx: number;
  sy: number;
  x: number;
  y: number;
  opacity: number;
  shown: boolean;
}

/** What the device can carry: its GPU adapter (if WebGPU) and screen. */
export async function detectDevice(): Promise<DeviceInfo> {
  const nav = navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> }; deviceMemory?: number };
  let webgpu = false;
  let fallbackAdapter = false;
  try {
    const adapter = (nav.gpu ? await nav.gpu.requestAdapter() : null) as { info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean } | null;
    webgpu = Boolean(adapter);
    fallbackAdapter = Boolean(adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter);
  } catch {
    webgpu = false;
  }
  return {
    webgpu,
    fallbackAdapter,
    coarse: matchMedia("(pointer: coarse)").matches,
    minScreen: Math.min(screen.width || innerWidth, screen.height || innerHeight),
    memory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    cores: typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null,
  };
}

export async function mountWorld(container: HTMLElement, options: WorldOptions): Promise<WorldHandle> {
  const device = await detectDevice();
  if (options.forceWebGL) device.webgpu = false;
  const tierName = options.tier ?? chooseTier(device);
  const tier: Tier = TIERS[tierName];
  const small = Math.min(innerWidth, innerHeight) < 600;
  // Multisampling: by tier, and on phones and tablets (tile-based GPUs resolve it on chip, nearly free).
  const antialias = tier.antialias || (device.coarse && !device.fallbackAdapter);
  const renderer = new WebGPURenderer({ antialias, alpha: false, forceWebGL: options.forceWebGL ?? false, reversedDepthBuffer: device.webgpu });
  const startDpr = Math.min(devicePixelRatio || 1, tier.maxDpr, small ? 1.5 : 2);
  const governor = new ResolutionGovernor(tier, startDpr);
  renderer.setPixelRatio(governor.dpr);
  renderer.shadowMap.enabled = tier.shadows;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  await renderer.init();
  const backend: WorldStats["backend"] = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl2";

  const canvas = renderer.domElement;
  canvas.className = "world-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const overlay = document.createElement("div");
  overlay.className = "world-overlay";
  container.append(canvas, overlay);

  const scene = new Scene();
  // Its near plane close in, so the spring arm can bring it near walls and posts without cutting into them (camera.ts).
  const camera = new PerspectiveCamera(45, 1, 0.25, 2000);
  const worldRoot = new Group();
  scene.add(worldRoot);
  const hemi = new HemisphereLight(0xffffff, 0x888888, 1);
  const sun = new DirectionalLight(0xffffff, 2);
  const sunTarget = new Object3D();
  sun.target = sunTarget;
  let shadows = tier.shadows;
  const SHADOW_FAR = 260;
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
    // Small biases (the shadow camera's range is tight): no acne on the facets, and no shadows floating off their feet.
    sun.shadow.bias = -0.00018;
    sun.shadow.normalBias = 0.025;
  }
  scene.add(hemi, sun, sunTarget);

  // The air: haze, mist, cloud shadows and lightning, as the scene's fog (atmosphere.ts).
  const atmosphere = new Atmosphere();
  scene.fogNode = atmosphere.node;
  weatherUniforms.splash.value = tier.splashes ? 1 : 0;

  const sky = new SkyDome();
  const rain = new Rain(scene, tier.rain);
  const horizon = new Horizon();
  scene.add(sky.group, horizon.group);
  const land = new Land(worldRoot, SEED, shadows, tier.waterGrid, tier.terrainFine);
  const vegetation = new Vegetation(worldRoot, tier, (x, y) => land.heightAt(x, y), (chunk, layer) => land.smallLayer(chunk, layer));
  // What's solid (collide.ts): the keep and its stations, the sites, and each chunk's trees and rocks as the
  // land grows and drops it (inside the land's own time budget: a chunk's solids take a few hundredths of a ms).
  const solids = new Solids();
  const plantSolids = new Map<object, number>();
  land.onGrow = (chunk) => {
    vegetation.addChunk(chunk);
    plantSolids.set(chunk, addPlants(solids, chunk.samples.layers.trees, chunk.samples.layers.rocks));
  };
  land.onDrop = (chunk) => {
    vegetation.removeChunk(chunk);
    solids.remove(plantSolids.get(chunk) ?? 0);
    plantSolids.delete(chunk);
  };
  const keep = new Keep(shadows, tier.lights);
  const knight = new Knight(shadows);
  const dog = new RobotDog(shadows);
  let colors = readThemeColors();
  const landmarks = new Landmarks((x, y) => land.heightAt(x, y), shadows);
  worldRoot.add(keep.group, knight.root, dog.root, landmarks.group);
  const glows = new Glows(worldRoot, tier.halos);
  glows.set("keep", keep.warmGlows, 0xffb866);
  glows.set("screens", keep.coolGlows, 0x8fe2ff);
  glows.set("landmarks", landmarks.windows, 0xffc27a);
  // The built places beyond the keep: the proving ground and the workshop hall.
  const placeContext: PlaceContext = { tier, shadows, ground: (x, y) => land.heightAt(x, y) };
  const places: Place[] = [new ProvingGround(placeContext), new Workshop(placeContext)];
  solids.add(KEEP_COLLIDERS);
  solids.add(SITE_COLLIDERS, (x, y) => land.heightAt(x, y));
  places.forEach((place, i) => {
    // Its own solids, and what moves there (machines: nothing pushes them, everyone gives way).
    solids.add(place.colliders, (x, y) => land.heightAt(x, y));
    for (const m of place.movers ?? []) solids.join(m, BUILDS.machine);
    worldRoot.add(place.group);
    glows.set(`place${i}:warm`, place.warmGlows, 0xffb866);
    glows.set(`place${i}:cool`, place.coolGlows, 0x8fe2ff);
  });
  const placeFrame: PlaceFrame = { dt: 0, t: 0, motion: true, focusX: 0, focusY: 0, distance: 0, follow: true, galahadX: 0, galahadY: 0, night: 0, rain: 0, wetness: 0, wind: BREEZE, windHeading: WIND_HEADING };
  // ---- experiments being built: on the workshop's assembly bench (assembly.ts) ----
  const assembly = new Assembly();
  worldRoot.add(assembly.group);
  let benchSparks = 0;

  // ---------- the ground, as each kind of walker sees it ----------
  let stationObstacles: Obstacle[] = obstacles();
  let plotsNow: { x: number; y: number; size: number }[] = [];
  const height = (x: number, y: number): number => land.heightAt(x, y);
  /** In water: a lake, or a stream's pool. */
  const wet = (x: number, y: number): boolean => land.heightAt(x, y) < land.waterAt(x, y) + 0.05;
  const insideAny = (list: Obstacle[], x: number, y: number): boolean => {
    for (let i = 0; i < list.length; i++) if (Math.hypot(x - list[i]!.x, y - list[i]!.y) < list[i]!.r) return true;
    return false;
  };
  /** In the water, not just at its edge: where nobody walks (the way keeps off the edge too: `wet`). */
  const deep = (x: number, y: number): boolean => land.heightAt(x, y) < land.waterAt(x, y) - 0.1;
  // Buildings, trunks, rocks and fences are the solids' business now; the ground keeps to water, sites and plots.
  const dogGround: Ground = { height, blocked: deep };
  const wildGround: Ground = {
    height,
    blocked: (x, y) => {
      if (wet(x, y) || Math.hypot(x, y) < KEEP_RADIUS + 6 || onSite(x, y, 6)) return true;
      for (let i = 0; i < plotsNow.length; i++) if (onPlot(plotsNow[i]!, x, y, 5)) return true;
      return false;
    },
  };
  const fauna = new Fauna(worldRoot, tier, wildGround);
  const plots = new Plots(colors, shadows, fauna);
  const duckGround: Ground = {
    height,
    blocked: (x, y) => {
      if (wet(x, y) || insideAny(stationObstacles, x, y) || Math.hypot(x, y) < 8.5 || onSite(x, y, 2)) return true;
      for (let i = 0; i < plotsNow.length; i++) if (onPlot(plotsNow[i]!, x, y, 3)) return true;
      return false;
    },
  };
  const critters = new Critters(worldRoot, tier.microducks, duckGround, shadows);
  fauna.join(solids);
  critters.flock.join(solids);
  /** The fleet's banners, the beacon and the plots' fences: solids that come and go with the model. */
  let fleetSolids = 0;
  let beaconSolids = 0;
  let plotSolids = 0;
  /** The camera's spring arm, and where it wants to be. */
  const arm = new SpringArm();
  const armPivot: Point3 = { x: 0, y: 0, z: 0 };
  const armWant: Point3 = { x: 0, y: 0, z: 0 };
  /**
   * Where the following camera may stand (camera.ts' trail): looking from there at him, nothing blocks the
   * view and it isn't inside anything or under the land (the real solids; the arm takes care of the rest).
   */
  const cameraClear = (x: number, y: number): boolean => {
    const t = rig.target;
    const ground = land.heightAt(t.x, t.y);
    const pz = ground + 2.3;
    const z = ground + 1.5 + t.distance * Math.sin(pitchFor(t.distance));
    if (land.heightAt(x, y) + 0.8 > z) return false;
    return solids.view(t.x, t.y, pz, x, y, z, 0.3, CAMERA_PAD) > 0.97;
  };
  const galahadLead = { x: 0, y: 0, heading: 0 };
  const dogLead = { x: 0, y: 0, heading: 0 };
  worldRoot.add(plots.group);

  const rig = new CameraRig();
  const walker = new Walker(standAt("keep"));
  // Galahad and his dog among the solids: he plans round them (nav.ts) and slides; it follows in his footsteps.
  const walkerMover = solids.join(walker, BUILDS.galahad);
  walkerMover.ground = deep;
  walker.join({ planner: new Planner(solids), mover: walkerMover, wet, deep });
  dog.join(solids, deep);
  // The page's `?colliders=1`: what's solid, drawn as lines (nothing is built without it).
  const colliderLines = wantsColliders(location.search) ? new ColliderLines(scene, solids, (x, y) => land.heightAt(x, y)) : null;
  let origin: [number, number] = [0, 0];
  const originScene = new Vector3();
  let model: WorldModel | null = null;
  let selected: string | null = null;
  let flatsKey = "";
  let dirty = true;
  let disposed = false;
  let lost = false;
  let override: TimePreset | null = null;
  const skyState = emptySky();
  const heavens = emptyHeavens();
  const weather = new Weather(options.weather ?? "clear");
  const lightning = new Lightning();
  let lastStrike = 0;
  /** Whether the high tier's light shafts are on: they draw the near air's glow then (with its shadows). */
  let shafted = false;

  let sparkTimer = 0;
  const anvil = forgeAnvil();
  const knightState: KnightState = { moving: false, running: false, working: false, thinking: false, armed: false, bench: false };
  const attention: Attention = { x: 0, y: 0, z: 0, on: false };
  const master = { x: 0, y: 0, heading: 0, moving: false, running: false, working: false };

  const root = document.documentElement;
  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = (): boolean => {
    const pref = root.dataset.motion;
    return pref === "reduce" || (pref !== "full" && motionQuery.matches);
  };

  renderer.onDeviceLost = (info) => {
    if (disposed || lost) return;
    lost = true;
    cancelAnimationFrame(raf);
    options.onLost(info.message || "The graphics device was reset.");
  };

  // ---------- sky, light, weather and theme ----------
  const skyTint = new Color();
  /** The sun and moon: the real ones over Denmark now, or a preset's. */
  function placeHeavens(): void {
    if (override) Object.assign(heavens, TIME_PRESETS[override]);
    else heavensAt(Date.now(), heavens);
  }
  function applySky(): void {
    skyFor(heavens, skyState);
    applyWeather(skyState, weather.state);
    const s = skyState;
    const w = weather.state;
    sky.set(s, w.rain, !reduced());
    horizon.set(s.light, s.horizon, s.night, s.sun, s.sunGlow, s.golden, s.cloud, s.underlight, Math.min(1, w.rain * 0.8 + w.snow));
    atmosphere.set(s, w.rain, w.snow);
    // (Half the shafts' glow: with no shadows in it, all of the near air would glow.)
    atmosphere.nearLight(shafted ? 0 : 0.5 * shaftStrength(), shaftColor(), shaftHaze());
    hemi.color.setHex(s.hemiSky);
    hemi.groundColor.setHex(s.hemiGround);
    hemi.intensity = s.hemiIntensity;
    sun.color.setHex(s.light);
    sun.intensity = s.lightIntensity;
    sun.shadow.intensity = s.shadow;
    renderer.toneMappingExposure = EXPOSURE * s.exposure;
    land.setWaterColor(s.water, s.horizon);
    // Wet things take the sky's colour as a sheen.
    weatherUniforms.sky.value.setHex(s.horizon).multiplyScalar(HAZE).lerp(skyTint.setHex(s.zenith), 0.5).multiplyScalar(1.1);
    weatherUniforms.wetness.value = w.wetness;
    weatherUniforms.rain.value = w.rain;
    weatherUniforms.snow.value = w.snowCover;
    rain.set(w.rain, w.snow, s.light, s.night, w.wind, !reduced());
    // Lamps come on as the sun gets low, before it's fully dark (sooner under cloud).
    keep.setNight(s.lamps);
    for (const place of places) place.setNight(s.lamps);
    glows.setStrength(s.lamps);
    knight.setNight(s.night);
    dog.setNight(s.night);
    dirty = true;
  }
  const applyTheme = () => {
    colors = readThemeColors();
    plots.setColors(colors);
    dirty = true;
  };
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  const schemeQuery = matchMedia("(prefers-color-scheme: dark)");
  schemeQuery.addEventListener("change", applyTheme);
  const motionChanged = () => {
    applySky();
  };
  motionQuery.addEventListener("change", motionChanged);
  const clock = () => {
    if (override !== null) return;
    placeHeavens();
    applySky();
  };
  placeHeavens();
  weather.snap(heavens.sunElevation * DEG, heavens.evening);
  clock();
  const clockTimer = setInterval(clock, 30_000);

  function setShadows(on: boolean): void {
    shadows = on;
    sun.castShadow = on;
    renderer.shadowMap.enabled = on;
    knight.setBlobShadow(!on);
    dog.setBlobShadow(!on);
  }
  setShadows(shadows);

  // ---------- labels ----------
  const labels = new Map<string, Label>();
  /** The same labels as a list, walked every frame without an iterator. */
  const labelList: Label[] = [];
  const addLabel = (key: string, el: HTMLElement, point: (out: Vec3) => boolean, fade = 4.5): void => {
    removeLabel(key);
    el.style.visibility = "hidden";
    overlay.append(el);
    const label: Label = { el, point, fade, sx: Number.NaN, sy: Number.NaN, x: Number.NaN, y: Number.NaN, opacity: -1, shown: false };
    labels.set(key, label);
    labelList.push(label);
  };
  const removeLabel = (key: string): void => {
    const label = labels.get(key);
    if (!label) return;
    label.el.remove();
    labels.delete(key);
    labelList.splice(labelList.indexOf(label), 1);
  };
  const div = (className: string, text?: string): HTMLElement => {
    const el = document.createElement("div");
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const copy = (src: Vec3) => (out: Vec3) => {
    out[0] = src[0];
    out[1] = src[1];
    out[2] = src[2];
    return true;
  };
  for (const place of PLACES) addLabel(`station:${place}`, div("world-label station", STATIONS[place].label), copy(stationLabelPoint(place)), 6);
  for (const site of SITE_NAMES) addLabel(`site:${site}`, div("world-label station", SITES[site].label), copy(SITE_VIEW[site].label), 14);

  const bubble = div("world-bubble");
  const bubbleDoing = div("doing");
  const bubbleThought = div("thought");
  const bubbleThinking = div("thinking");
  bubble.append(bubbleDoing, bubbleThought, bubbleThinking);
  bubble.hidden = true;
  addLabel(
    "bubble",
    bubble,
    (out) => {
      out[0] = walker.x;
      out[1] = walker.y;
      out[2] = groundAt(walker.x, walker.y) + HEAD_HEIGHT;
      return true;
    },
    10,
  );

  function syncExperimentLabels(m: WorldModel): void {
    const ids = new Set(m.experiments.map((e) => e.id));
    for (const key of [...labels.keys()]) if (key.startsWith("exp:") && !ids.has(key.slice(4))) removeLabel(key);
    for (const e of m.experiments) {
      const key = `exp:${e.id}`;
      let label = labels.get(key);
      if (!label) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "world-label exp";
        el.addEventListener("click", () => options.onSelect(e.id));
        addLabel(
          key,
          el,
          (out) => {
            const plot = plots.get(e.id);
            if (!plot) return false;
            const s = plot.signPoint;
            out[0] = s[0];
            out[1] = s[1];
            out[2] = s[2];
            return true;
          },
          6,
        );
        label = labels.get(key)!;
      }
      const el = label.el;
      el.dataset.status = e.status;
      el.setAttribute("aria-pressed", String(e.id === selected));
      const text = `${e.title} · ${ENGINE_LABEL[e.engine]} · ${STATUS_LABEL[e.status]}`;
      if (el.title !== text) {
        el.title = text;
        el.replaceChildren(div("dot"), div("name", e.title), div("meta", `${ENGINE_LABEL[e.engine]} · ${STATUS_LABEL[e.status]}`));
      }
    }
  }

  function syncNodeLabels(): void {
    for (const key of [...labels.keys()]) if (key.startsWith("node:")) removeLabel(key);
    for (const spot of keep.spots) {
      const el = div("world-label node");
      el.dataset.online = String(spot.node.online);
      el.append(div("dot"), document.createTextNode(spot.node.name + (spot.node.sandboxHost ? " · sandboxes" : "")));
      addLabel(`node:${spot.node.id}`, el, copy(spot.label), 3);
    }
  }

  function syncBodyLabels(): void {
    for (const key of [...labels.keys()]) if (key.startsWith("body:")) removeLabel(key);
    if (!selected) return;
    const plot = plots.get(selected);
    if (!plot) return;
    plot.labelled.forEach((body, i) => {
      addLabel(`body:${i}`, div("world-label body", body.def.label ?? ""), (out) => plot.bodyPoint(body, out), 5);
    });
  }

  function syncBubble(m: WorldModel): void {
    const g = m.galahad;
    bubbleDoing.textContent = g.doing;
    const thought = m.thoughts.at(-1) ?? "";
    bubbleThought.textContent = thought;
    bubbleThought.hidden = !thought;
    bubbleThinking.hidden = !g.model;
    if (g.model) bubbleThinking.replaceChildren(div("dots"), document.createTextNode(`thinking with ${g.model}`));
    bubble.hidden = !g.doing && !thought;
  }

  // ---------- Galahad ----------
  const groundAt = (x: number, y: number): number => Math.max(land.heightAt(x, y), WATER_LEVEL - 0.6);
  // No rain falls under the workshop hall's roof.
  rain.setHallFloor(groundAt(HALL.x, HALL.y));
  let walkKey = "";
  function retarget(m: WorldModel): void {
    const target = buildingAt(m.galahad, m.experiments) ?? targetFor(m.galahad, m.experiments);
    const key = `${m.galahad.station}|${m.galahad.experiment}|${target.x.toFixed(2)},${target.y.toFixed(2)}`;
    if (key === walkKey) return;
    walkKey = key;
    walker.go(target, stationObstacles, reduced());
    dirty = true;
  }

  /** What he looks at (and works on): the bench at the lab, his experiment's plot, the station he's at. */
  function attend(): void {
    const g = model?.galahad;
    attention.on = false;
    if (!g || walker.moving) return;
    if (g.station === "forge") {
      attention.x = anvil[0];
      attention.y = anvil[1];
      attention.z = anvil[2] + 0.02;
      attention.on = true;
    } else if (g.station === "field") {
      const e = g.experiment ? plots.get(g.experiment)?.exp : undefined;
      if (!e) return;
      attention.x = e.plot.x;
      attention.y = e.plot.y;
      attention.z = 1.2;
      attention.on = true;
    } else if (g.doing && !g.model && g.station !== "keep") {
      const s = STATIONS[g.station];
      attention.x = s.x;
      attention.y = s.y;
      attention.z = 1.3;
      attention.on = true;
    }
  }

  // ---------- input ----------
  const raycaster = new Raycaster();
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  const hit = new Vector3();
  const ndc = new Vector2();
  const stopFollowing = () => {
    if (!rig.follow) return;
    rig.follow = false;
    options.onFollow(false);
  };
  const detachInput = attachInput(canvas, {
    pan(dx, dy) {
      stopFollowing();
      rig.panPixels(dx, dy, canvas.clientHeight, camera.fov);
      dirty = true;
    },
    zoom(factor) {
      rig.zoomBy(factor);
      dirty = true;
    },
    rotate(radians) {
      rig.rotateBy(radians);
      dirty = true;
    },
    interacted() {
      dirty = true;
    },
    tap(clientX, clientY) {
      // A Microduck or an arm under the finger: say what it is (for a moment) rather than select.
      if (probe(clientX, clientY)) {
        hoverAt[0] = clientX;
        hoverAt[1] = clientY;
        hoverUntil = performance.now() + 3000;
        dirty = true;
        return;
      }
      if (!groundUnder(clientX, clientY)) return;
      options.onSelect(plots.pick(hit.x + origin[0], -hit.z + origin[1]));
    },
    hover(clientX, clientY) {
      hoverAt[0] = clientX;
      hoverAt[1] = clientY;
      hoverUntil = Number.POSITIVE_INFINITY;
      dirty = true;
    },
  });
  const leave = () => {
    hoverUntil = 0;
    dirty = true;
  };
  canvas.addEventListener("pointerleave", leave);

  /**
   * The ground point (scene, relative to the origin) under a screen point, into `hit`: on the plane at
   * the keep's height first, then on the plane at the ground's height there, twice (the proving
   * ground stands 5 m up; seen from low down that's metres of difference).
   */
  function groundUnder(clientX: number, clientY: number): boolean {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    groundPlane.constant = 0;
    if (raycaster.ray.intersectPlane(groundPlane, hit) === null) return false;
    for (let i = 0; i < 2; i++) {
      const level = Math.max(0, groundAt(hit.x + origin[0], -hit.z + origin[1]));
      if (level < 0.5) break;
      groundPlane.constant = -level;
      if (raycaster.ray.intersectPlane(groundPlane, hit) === null) return false;
    }
    return true;
  }

  // ---------- hover labels: "Open Duck Mini (Antoine Pirrone)", "SO-101 arm (LeRobot)" ----------
  const hoverLabel = div("world-label hover");
  hoverLabel.style.visibility = "hidden";
  overlay.append(hoverLabel);
  const hoverAt: [number, number] = [0, 0];
  const hoverPoint: Vec3 = [0, 0, 0];
  let hoverUntil = 0;
  let hoverShown = false;
  function probe(clientX: number, clientY: number): string | null {
    if (!groundUnder(clientX, clientY)) return null;
    const x = hit.x + origin[0];
    const y = -hit.z + origin[1];
    const text = critters.hover(x, y, hoverPoint);
    if (text) return text;
    for (const place of places) {
      const name = place.hover?.(x, y, hoverPoint);
      if (name) return name;
    }
    return null;
  }
  function placeHover(): void {
    const text = performance.now() < hoverUntil ? probe(hoverAt[0], hoverAt[1]) : null;
    if (!text) {
      if (hoverShown) {
        hoverLabel.style.visibility = "hidden";
        hoverShown = false;
      }
      return;
    }
    if (hoverLabel.textContent !== text) hoverLabel.textContent = text;
    projected.set(hoverPoint[0] - origin[0], groundAt(hoverPoint[0], hoverPoint[1]) + hoverPoint[2], -(hoverPoint[1] - origin[1]));
    projected.project(camera);
    hoverLabel.style.transform = `translate3d(${Math.round(((projected.x + 1) / 2) * canvas.clientWidth)}px, ${Math.round(((1 - projected.y) / 2) * canvas.clientHeight)}px, 0) translate(-50%, -100%)`;
    if (!hoverShown) {
      hoverLabel.style.visibility = "visible";
      hoverShown = true;
    }
  }

  // ---------- size ----------
  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  // The high tier's finish: ambient occlusion, sun shafts, bloom (WebGPU only; none on phones or WebGL2).
  const post = backend === "webgpu" && (tier.post.ao || tier.post.shafts || tier.post.bloom) ? new Post(renderer, scene, camera, governor.post, sun, atmosphere.shaftAir) : null;
  shafted = post?.shafting ?? false;
  applySky();

  // Every material's pipeline compiled before the first frame (and the night's glows with them), so
  // nothing stalls later when a chunk's grass or the lamps first appear.
  {
    const hidden: Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    rig.apply(camera, origin, 0);
    camera.updateMatrixWorld();
    try {
      await renderer.compileAsync(scene, camera);
      // Through the post pipeline too: its passes, and every material again for its own render target.
      if (post?.active) {
        post.render();
        await post.compile();
      }
    } catch {
      /* compiling ahead is an optimisation: the first frames compile what's left */
    }
    for (const o of hidden) o.visible = false;
  }

  // ---------- the loop ----------
  const projected = new Vector3();
  const point: Vec3 = [0, 0, 0];
  /**
   * Projects every label with the camera as it is this frame, eases it there
   * (screen space, quickly: it smooths sub-pixel wobble without lagging) and
   * snaps it to device pixels, writing styles only when they change.
   */
  function placeLabels(dt: number): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = devicePixelRatio || 1;
    const ease = 1 - Math.exp(-dt * 28);
    for (let i = 0; i < labelList.length; i++) {
      const label = labelList[i]!;
      if (label.el.hidden) continue;
      let visible = label.point(point);
      let opacity = 0;
      if (visible) {
        projected.set(point[0] - origin[0], point[2], -(point[1] - origin[1]));
        const dist = projected.distanceTo(camera.position);
        projected.project(camera);
        visible = !(projected.z > 1 || projected.x < -1.2 || projected.x > 1.2 || projected.y < -1.2 || projected.y > 1.3);
        opacity = Math.max(0, Math.min(1, 1 - dist / (rig.distance * label.fade)));
        visible = visible && opacity > 0.02;
      }
      if (!visible) {
        if (label.shown) {
          label.el.style.visibility = "hidden";
          label.shown = false;
        }
        continue;
      }
      const tx = ((projected.x + 1) / 2) * w;
      const ty = ((1 - projected.y) / 2) * h;
      // A label that just appeared, or jumped (a cut), goes straight there.
      if (!label.shown || Number.isNaN(label.sx) || Math.abs(tx - label.sx) + Math.abs(ty - label.sy) > 60) {
        label.sx = tx;
        label.sy = ty;
      } else {
        label.sx += (tx - label.sx) * ease;
        label.sy += (ty - label.sy) * ease;
      }
      const x = Math.round(label.sx * dpr) / dpr;
      const y = Math.round(label.sy * dpr) / dpr;
      if (!label.shown) {
        label.el.style.visibility = "visible";
        label.shown = true;
      }
      if (x !== label.x || y !== label.y) {
        label.x = x;
        label.y = y;
        label.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
      }
      const o = opacity < 0.995 ? Math.round(opacity * 50) / 50 : 1;
      if (o !== label.opacity) {
        label.opacity = o;
        label.el.style.opacity = o === 1 ? "1" : String(o);
      }
    }
  }

  /** Keeps the sun's shadow over the focus, its frame snapped to whole shadow-map texels (no shimmering as it moves). */
  const lightRight = new Vector3();
  const lightUp = new Vector3();
  const lightDir = new Vector3();
  const focus = new Vector3();
  /** Half the side of the shadow map's box, metres. */
  let shadowRadius = 40;
  function placeSun(fx: number, fy: number, fz: number, dir: readonly [number, number, number]): void {
    lightDir.set(dir[0], Math.max(0.15, dir[2]), -dir[1]).normalize();
    focus.set(fx, fy, fz);
    if (shadows) {
      // A radius in whole steps of 4 m (zooming doesn't swim either), and the focus on the texel grid in the light's frame.
      const r = Math.ceil((rig.distance * 1.6 + 20) / 4) * 4;
      shadowRadius = r;
      const texel = (2 * r) / tier.shadowMapSize;
      lightRight.set(0, 1, 0).cross(lightDir).normalize();
      lightUp.crossVectors(lightDir, lightRight).normalize();
      const u = focus.dot(lightRight);
      const v = focus.dot(lightUp);
      focus.addScaledVector(lightRight, Math.round(u / texel) * texel - u).addScaledVector(lightUp, Math.round(v / texel) * texel - v);
      const cam = sun.shadow.camera;
      if (cam.right !== r) {
        cam.left = -r;
        cam.right = r;
        cam.top = r;
        cam.bottom = -r;
        cam.near = 1;
        cam.far = SHADOW_FAR;
        cam.updateProjectionMatrix();
      }
    }
    sunTarget.position.copy(focus);
    sun.position.copy(focus).addScaledVector(lightDir, 110);
  }

  /** Moves the weather on, re-lighting the sky at most ten times a second while it changes; true while it rains (every frame wanted). */
  let lastSkyAt = 0;
  const lastWeather = { cloud: -1, rain: -1, mist: -1, wetness: -1, snow: -1, snowCover: -1, wind: -1, windHeading: -1 };
  function stepWeather(dt: number, motion: boolean, now: number): boolean {
    const w = weather.step(dt, skyState.sunElevation * DEG, heavens.evening);
    // The wind's way: the rain's lean, the drifts and the sky's curtains all read it.
    setWindHeading(w.windHeading);
    // Clocks move only while there's something for them to move: every change is an upload for each
    // material that reads it, which a phone pays for on a dry, clear day for nothing.
    if (motion) {
      if (w.rain > 0.001 || w.snow > 0.001) {
        // Wrapped so the GPU's floats stay precise in a page left open for days (2000 s: the ripples' phase is whole there).
        weatherUniforms.time.value = (weatherUniforms.time.value + dt) % 2000;
        rain.blow(dt, w.wind);
      }
      if (w.cloud > 0.002) sky.blow(dt, w.wind);
      atmosphere.drift(dt, w.wind);
    }
    // Lightning: a flash lights the land, the air, the clouds and the rain (never under reduced motion).
    const flash = lightning.step(dt, w.storm, motion, Math.PI / 2 - rig.yaw);
    if (flash !== weatherUniforms.flash.value) {
      weatherUniforms.flash.value = flash;
      dirty = true;
    }
    if (lightning.strike !== lastStrike) {
      lastStrike = lightning.strike;
      sky.strike(lightning.bearing, lightning.bolt, lightning.strike);
    }
    const moved =
      Math.abs(w.cloud - lastWeather.cloud) + Math.abs(w.rain - lastWeather.rain) + Math.abs(w.mist - lastWeather.mist) + Math.abs(w.wetness - lastWeather.wetness) + Math.abs(w.snow - lastWeather.snow) + Math.abs(w.snowCover - lastWeather.snowCover) + Math.abs(w.wind - lastWeather.wind) * 0.01 + Math.abs(w.windHeading - lastWeather.windHeading) * 0.01 > 2e-4;
    if (moved && now - lastSkyAt > 100) {
      lastSkyAt = now;
      lastWeather.cloud = w.cloud;
      lastWeather.rain = w.rain;
      lastWeather.mist = w.mist;
      lastWeather.wetness = w.wetness;
      lastWeather.snow = w.snow;
      lastWeather.snowCover = w.snowCover;
      lastWeather.wind = w.wind;
      lastWeather.windHeading = w.windHeading;
      applySky();
    }
    // (Re-lighting marks the frame dirty; falling rain and snow want every frame.)
    return motion && (w.rain > 0.01 || w.snow > 0.01);
  }
  /** The light in the air: the sun's glow by day, the moon's light by night (sRGB). */
  function shaftColor(): number {
    return skyState.lightFromSun ? skyState.sunGlow : skyState.light;
  }
  /** How much the clear air scatters, per metre: thicker under a low sun, and in rain and snow. */
  function shaftHaze(): number {
    return 0.004 + 0.009 * skyState.golden + 0.004 * weather.state.rain + 0.003 * weather.state.snow;
  }
  /** How strongly the light's shafts show: low suns make them; a closed deck of cloud takes them away; the moon's are faint. */
  function shaftStrength(): number {
    const s = skyState;
    // Broken cloud lets the light through; a closed deck (overcast, rain, a storm) has no direct light to make shafts.
    const gap = Math.min(1, Math.max(0, (0.9 - s.cloud) / 0.55));
    const clear = gap * gap * (3 - 2 * gap);
    if (!s.lightFromSun) return 0.4 * s.night * s.moonUp * s.moonLit * clear;
    const low = 1 - Math.min(1, Math.max(0, (s.sunElevation * DEG - 5) / 35));
    return (0.55 + 0.35 * low) * clear * Math.min(1, (s.sunElevation * DEG) / 1.5);
  }

  let raf = 0;
  let lastTick = performance.now();
  let lastRender = 0;
  let renderedLast = false;
  let frames = 0;
  let windowStart = performance.now();
  let fps = 0;
  let frameMs = 0;
  let frameMsSum = 0;
  let drawCalls = 0;
  const idleInterval = tier.name === "low" ? 50 : 33;

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (document.hidden || lost) {
      lastTick = now;
      renderedLast = false;
      return;
    }
    const motion = !reduced();
    // What grows bends with the weather's wind: as it always did in a light breeze, hard in a storm.
    // (A whole step at a time, so the uniform, and every plant material with it, isn't uploaded as the wind eases.)
    wind.value = motion ? Math.min(2.6, Math.max(0.4, Math.round((0.46 + 0.18 * weather.state.wind) * 10) / 10)) : 0;
    waterUniforms.waves.value = motion ? 1 : 0;
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    let active = walker.step(dt);
    // The weather moves on (re-lighting marks the frame dirty); while it rains, every frame is drawn.
    if (stepWeather(dt, motion, now)) active = true;
    if (rig.follow) {
      rig.lookAt(walker.x, walker.y);
      rig.trail(walker.heading, walker.moving, dt, cameraClear);
    }
    active = rig.update(dt, motion) || active;
    active = plots.animate(now, skyState.horizon) || active;
    active = assembly.animate(now, motion) || active;
    const ambient = motion && now - lastRender >= idleInterval;
    if (!dirty && !active && !ambient) {
      renderedLast = false;
      return;
    }
    if (now - lastRender < FRAME_MIN_MS) return;
    const started = performance.now();
    const renderDt = Math.min(0.1, (now - lastRender) / 1000);
    frames++;
    frameMsSum += now - lastRender;
    if (now - windowStart >= 1000) {
      fps = frames;
      frameMs = frames ? frameMsSum / frames : 0;
      frames = 0;
      frameMsSum = 0;
      windowStart = now;
    }
    const judged = renderedLast && (active || dirty);
    const interval = now - lastRender;
    lastRender = now;
    renderedLast = true;
    dirty = false;
    const t = now / 1000;

    // Floating origin: far from it, move it (and so the whole world) under the camera.
    if (Math.hypot(rig.x - origin[0], rig.y - origin[1]) > REBASE_M) {
      origin = [Math.round(rig.x / 64) * 64, Math.round(rig.y / 64) * 64];
      worldRoot.position.set(-origin[0], 0, origin[1]);
      originScene.set(origin[0], 0, -origin[1]);
      vegetation.place(origin[0], origin[1]);
      fauna.place(originScene);
      critters.place(originScene);
      originUniform.value.set(origin[0], origin[1]);
    }
    // Land and what grows on it: nearest first, within this frame's budget.
    const deadline = started + tier.chunkMs;
    const loadRadius = Math.min(tier.radius, Math.max(tier.radius * 0.75, rig.distance * 1.7 + 70));
    const growing = land.update(rig.x, rig.y, loadRadius, deadline, tier.chunkBudget);
    const filling = vegetation.update(rig.x, rig.y, deadline);
    if (growing || filling) dirty = true;
    atmosphere.reach(loadRadius, rig.distance);

    // Galahad and his dog.
    const g = model?.galahad;
    const atWork = !walker.moving && Boolean(g?.doing);
    knightState.moving = walker.moving;
    knightState.running = walker.running;
    knightState.working = atWork;
    knightState.thinking = !walker.moving && Boolean(g?.model);
    knightState.armed = !walker.moving && (g?.station === "field" || g?.station === "forge");
    knightState.bench = g?.station === "forge";
    attend();
    // ---- building an experiment: at the assembly bench he works as at the lab's, blade's tip to the parts ----
    const atBench = !walker.moving && g ? buildingAt(g, model!.experiments) : null;
    if (atBench) {
      knightState.bench = true;
      knightState.armed = true;
      attention.x = atBench.bench.x;
      attention.y = atBench.bench.y;
      attention.z = atBench.bench.z;
      attention.on = true;
      if (motion) {
        benchSparks -= renderDt;
        if (benchSparks <= 0) {
          benchSparks = 0.4;
          fauna.sparksAt(atBench.bench.x, atBench.bench.y - 0.15, atBench.bench.z + 0.05, 2);
        }
      }
    }
    const gz = groundAt(walker.x, walker.y);
    // Characters sit in the world root at their absolute place (only instanced things are origin-relative).
    knight.root.position.set(walker.x, gz, -walker.y);
    knight.root.rotation.y = headingToSceneYaw(walker.heading);
    knight.animate(renderDt, t, knightState, walker.x, walker.y, gz, walker.heading, groundAt, attention, motion);
    master.x = walker.x;
    master.y = walker.y;
    master.heading = walker.heading;
    master.moving = walker.moving;
    master.running = walker.running;
    master.working = atWork || knightState.thinking;
    dog.step(renderDt, t, master, dogGround, motion, groundAt);
    // Walkers that ended up overlapping are parted (the lighter gives way), before they're drawn.
    solids.separate();
    dog.apply(groundAt(dog.x, dog.y), ZERO);
    keep.animate(t, motion);
    landmarks.animate(t, motion);
    placeFrame.dt = renderDt;
    placeFrame.t = t;
    placeFrame.motion = motion;
    placeFrame.focusX = rig.x;
    placeFrame.focusY = rig.y;
    placeFrame.distance = rig.distance;
    placeFrame.follow = rig.follow;
    placeFrame.galahadX = walker.x;
    placeFrame.galahadY = walker.y;
    placeFrame.night = skyState.night;
    placeFrame.rain = weather.state.rain;
    placeFrame.wetness = weather.state.wetness;
    // The weather's wind (Denmark's when live, the preset's otherwise): the windsocks agree with the rain.
    placeFrame.wind = weather.state.wind;
    placeFrame.windHeading = weather.state.windHeading;
    for (let i = 0; i < places.length; i++) places[i]!.animate(placeFrame);

    // Sparks fly from the bench where his blade's tip works.
    if (motion && atWork && g?.station === "forge") {
      sparkTimer -= renderDt;
      if (sparkTimer <= 0) {
        sparkTimer = 0.22;
        fauna.sparksAt(anvil[0], anvil[1], anvil[2], 3);
      }
    }
    const dusk = Math.min(1, skyState.night * 1.4) * (skyState.evening > 0.5 ? 1 : 0.4) * (1 - weather.state.rain);
    fauna.step(renderDt, rig.x, rig.y, origin, skyState.night, dusk, motion);
    galahadLead.x = walker.x;
    galahadLead.y = walker.y;
    galahadLead.heading = walker.heading;
    dogLead.x = dog.x;
    dogLead.y = dog.y;
    dogLead.heading = dog.heading;
    critters.step(renderDt, t, galahadLead, dogLead, groundAt, atWork && g?.station === "forge", origin, motion);

    // The camera, over a smoothed ground; then everything that depends on where it is.
    const focusGround = rig.settle(Math.max(0, groundAt(rig.x, rig.y)), renderDt, motion);
    // On its spring arm: over the land, before what blocks the view, never inside anything.
    rig.wanted(focusGround, armWant, armPivot);
    arm.update(armPivot, armWant, solids, groundAt, renderDt, motion);
    rig.apply(camera, origin, focusGround, arm);
    colliderLines?.update(rig.x, rig.y, origin, arm.x, arm.y, arm.z);
    camera.updateMatrixWorld();
    atmosphere.ground(focusGround, renderDt);
    occlusion.from.value.copy(camera.position);
    occlusion.to.value.set(walker.x - origin[0], gz + 1.3, -(walker.y - origin[1]));
    occlusion.floor.value = gz;
    occlusion.on.value = rig.follow ? 1 : 0;
    sky.follow(camera.position);
    horizon.follow(camera.position, t, motion);
    // The light: from the sun by day, the moon by night, kept over the focus.
    placeSun(rig.x - origin[0], focusGround, -(rig.y - origin[1]), skyState.lightDir);
    if (post?.active) {
      // The shafts reach from the camera to the far side of the shadow map's box; the air is thicker under a low sun.
      const w = weather.state;
      post.update(lightDir, shaftStrength(), shaftColor(), rig.distance + shadowRadius * 0.9, shaftHaze());
      post.render();
    } else renderer.render(scene, camera);
    drawCalls = renderer.info.render.drawCalls;
    placeLabels(renderDt);
    placeHover();
    // Only frames rendered back to back, at full rate, and not growing land, say how long a frame takes.
    if (judged && !growing && !filling) {
      const action = governor.frame(now, interval);
      if (action === "dpr") {
        renderer.setPixelRatio(governor.dpr);
        resize();
      } else if (action === "drop-post") {
        post?.set(governor.post);
        // Shafts shed: the near air's glow goes back to the fog.
        shafted = post?.shafting ?? false;
        applySky();
      }
      else if (action === "drop-shadows") setShadows(false);
      else if (action === "drop-grass") vegetation.dropGrass();
    }
  }
  raf = requestAnimationFrame(frame);
  const visibility = () => {
    if (!document.hidden) {
      dirty = true;
      governor.reset();
    }
  };
  document.addEventListener("visibilitychange", visibility);

  return {
    update(next, event) {
      if (disposed) return;
      const prev = model;
      model = next;
      if (event?.type === "frame") plots.push(event.frame, event.at, performance.now());
      if (!prev || prev.experiments !== next.experiments) {
        if (plots.sync(next.experiments, next.frames)) dirty = true;
        const key = next.experiments.map((e) => `${e.plot.x},${e.plot.y},${e.plot.size}`).join("|");
        if (key !== flatsKey) {
          flatsKey = key;
          plotsNow = next.experiments.map((e) => e.plot);
          stationObstacles = obstacles(next.experiments);
          // Pads on the sites stand on ground that's level already; their machines make way for the experiment.
          const open = next.experiments.filter((e) => !padAt(e.plot));
          // Each plot's fence, gate, sign and dome are solid; a pad's sign too.
          solids.remove(plotSolids);
          plotSolids = solids.add(next.experiments.flatMap((e) => plotColliders(e.plot)), (x, y) => land.heightAt(x, y));
          land.setFlats([...BASE_FLATS, ...open.map((e) => plotFlat(e.plot))]);
          const occupied = new Set<string>();
          for (const e of next.experiments) {
            const pad = padAt(e.plot);
            if (pad) occupied.add(pad.id);
          }
          for (const place of places) place.setOccupied(occupied);
          dirty = true;
        }
        syncExperimentLabels(next);
        if (selected && !next.experiments.some((e) => e.id === selected)) options.onSelect(null);
      }
      if (!prev || prev.galahad !== next.galahad || prev.experiments !== next.experiments) {
        retarget(next);
        if (assembly.sync(benchFor(next), event?.at ?? next.at, performance.now())) dirty = true;
      }
      if (!prev || prev.galahad !== next.galahad || prev.thoughts !== next.thoughts) {
        syncBubble(next);
        dirty = true;
      }
      if (!prev || prev.nodes !== next.nodes) {
        keep.setNodes(next.nodes);
        solids.remove(fleetSolids);
        fleetSolids = solids.add(fleetColliders(keep.spots.map((spot) => spot.node.sandboxHost)));
        syncNodeLabels();
        dirty = true;
      }
      if (!prev) {
        // First sight: put him (and the dog) where he is at once, and the camera on him.
        walker.go(buildingAt(next.galahad, next.experiments) ?? targetFor(next.galahad, next.experiments), stationObstacles, true);
        knight.place(walker.x, walker.y, walker.heading, groundAt);
        dog.place({ x: walker.x, y: walker.y, heading: walker.heading, moving: false, running: false, working: true }, groundAt);
        // A three-quarter view of his front to begin with (he turns his back as he walks off, and the view swings round).
        rig.lookAt(walker.x, walker.y);
        rig.target.yaw = walker.heading + Math.PI - 0.6;
        rig.trail(walker.heading, false, 0, cameraClear);
        rig.update(0, false);
      }
    },
    setFollow(on) {
      rig.follow = on;
      if (on) rig.lookAt(walker.x, walker.y);
      dirty = true;
    },
    goTo(target) {
      if (target.kind === "galahad") {
        rig.follow = true;
        options.onFollow(true);
        rig.lookAt(walker.x, walker.y, DEFAULT_DISTANCE);
      } else {
        stopFollowing();
        if (target.kind === "station") {
          const s = STATIONS[target.station];
          rig.lookAt(s.x, s.y, STATION_DISTANCE);
        } else if (target.kind === "site") {
          const v = SITE_VIEW[target.site];
          rig.lookAt(v.x, v.y, v.distance);
          rig.target.yaw = v.yaw;
        } else if (target.kind === "point") {
          if (Number.isFinite(target.x) && Number.isFinite(target.y)) rig.lookAt(target.x, target.y);
        } else {
          const e = plots.get(target.id)?.exp;
          if (e) rig.lookAt(e.plot.x, e.plot.y, Math.max(28, e.plot.size * 1.6));
        }
      }
      dirty = true;
    },
    zoom(steps) {
      rig.zoomBy(1.25 ** -steps);
      dirty = true;
    },
    rotate(steps) {
      rig.rotateBy((steps * Math.PI) / 8);
      dirty = true;
    },
    pan(right, forward) {
      stopFollowing();
      rig.panMetres(right * rig.target.distance * 0.18, forward * rig.target.distance * 0.18);
      dirty = true;
    },
    select(id) {
      selected = id;
      plots.select(id);
      for (const [key, label] of labels) if (key.startsWith("exp:")) label.el.setAttribute("aria-pressed", String(key.slice(4) === id));
      syncBodyLabels();
      dirty = true;
    },
    setBeacon(on) {
      if (keep.beaconOn === on) return;
      keep.setBeacon(on);
      solids.remove(beaconSolids);
      beaconSolids = on ? solids.add(BEACON_COLLIDERS) : 0;
      dirty = true;
    },
    setTimeOfDay(preset) {
      override = preset;
      placeHeavens();
      weather.settleMist(heavens.sunElevation * DEG, heavens.evening);
      applySky();
    },
    setWeather(kind) {
      weather.set(kind);
      dirty = true;
    },
    aimWeather(target, snap = false) {
      weather.aim(target);
      if (snap) weather.snap(heavens.sunElevation * DEG, heavens.evening);
      dirty = true;
    },
    where(out) {
      out.galahadX = walker.x;
      out.galahadY = walker.y;
      out.galahadHeading = walker.heading;
      out.focusX = rig.x;
      out.focusY = rig.y;
      out.yaw = rig.yaw;
      out.distance = rig.distance;
      return out;
    },
    stats() {
      return {
        backend,
        tier: tier.name,
        dpr: governor.dpr,
        fps,
        frameMs: Math.round(frameMs * 10) / 10,
        drawCalls,
        shadows,
        effects: post?.active ? Object.entries(governor.post).filter(([, on]) => on).map(([name]) => name) : [],
        instances: vegetation.counts(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      clearInterval(clockTimer);
      document.removeEventListener("visibilitychange", visibility);
      themeObserver.disconnect();
      schemeQuery.removeEventListener("change", applyTheme);
      motionQuery.removeEventListener("change", motionChanged);
      resizeObserver.disconnect();
      detachInput();
      canvas.removeEventListener("pointerleave", leave);
      land.dispose();
      vegetation.dispose();
      keep.dispose();
      for (const place of places) place.dispose();
      knight.dispose();
      colliderLines?.dispose();
      dog.dispose();
      fauna.dispose();
      critters.dispose();
      plots.dispose();
      assembly.dispose();
      landmarks.dispose();
      glows.dispose();
      rain.dispose();
      post?.dispose();
      sky.dispose();
      horizon.dispose();
      sun.dispose();
      hemi.dispose();
      renderer.dispose();
      canvas.remove();
      overlay.remove();
    },
  };
}
