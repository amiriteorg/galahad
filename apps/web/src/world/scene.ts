import type { Station, WorldEvent } from "@galahad/core/world";
import { STATIONS } from "@galahad/core/world";
import { DirectionalLight, Fog, Group, HemisphereLight, Object3D, PCFShadowMap, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGPURenderer } from "three/webgpu";
import { ENGINE_LABEL, STATUS_LABEL, type WorldModel } from "../lib/world.ts";
import { attachInput, CameraRig } from "./camera.ts";
import { headingToSceneYaw, onPlot, type Vec3 } from "./coords.ts";
import { emptySky, localHours, skyAt } from "./daynight.ts";
import { RobotDog } from "./dog.ts";
import { Critters } from "./critters.ts";
import { Fauna } from "./fauna.ts";
import { forgeAnvil, Keep, stationLabelPoint } from "./keep.ts";
import { HEAD_HEIGHT, Knight, type KnightState } from "./knight.ts";
import { Land } from "./land.ts";
import { readThemeColors } from "./palette.ts";
import { type Obstacle, obstacles, PLACES, standAt, targetFor, Walker } from "./path.ts";
import type { Ground } from "./physics.ts";
import { originUniform, Plots } from "./plots.ts";
import { Horizon, Landmarks } from "./scenery.ts";
import { SkyDome } from "./sky.ts";
import { KEEP_FLAT, KEEP_RADIUS, plotFlat, SEED, WATER_LEVEL } from "./terrain.ts";
import { chooseTier, type DeviceInfo, ResolutionGovernor, type Tier, TIERS, type TierName } from "./tiers.ts";
import { Vegetation, wind } from "./vegetation.ts";

/*
 * The SANDBOX's renderer, on three.js's WebGPU renderer (its WebGL2 backend where
 * WebGPU isn't available): the land and what grows on it, the treehouse keep and
 * its stations, the plots, Galahad and his dog, birds, deer, rabbits, ducks and
 * fireflies, a sky that follows the viewer's clock, and HTML labels and a speech
 * bubble projected from 3D. A quality tier chosen at start caps everything; the
 * resolution governor holds the frame time (pixel ratio first, then effects).
 * It renders at most 60 frames a second (idle life at 30, less on low tiers),
 * pauses while the page is hidden, allocates nothing per frame in its own code,
 * and gives every GPU resource back when disposed. If the GPU device is lost it
 * says so through `onLost`, and the page decides (a restart, or the text summary).
 */

export type GoTo = { kind: "galahad" } | { kind: "station"; station: Exclude<Station, "field"> } | { kind: "experiment"; id: string };

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
  /** A fixed hour to look at (0–24), or null for the viewer's own clock. */
  setTimeOfDay(hours: number | null): void;
  stats(): WorldStats;
  dispose(): void;
}

const REBASE_M = 2048;
const ZERO: [number, number] = [0, 0];

interface Label {
  el: HTMLElement;
  /** Writes the world point (z up) into `out`; false when there's nothing to show. */
  point: (out: Vec3) => boolean;
  /** Fade out beyond this many camera distances. */
  fade: number;
  /** Last written screen position, to skip unchanged style writes. */
  x: number;
  y: number;
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
  const renderer = new WebGPURenderer({ antialias: tier.antialias, alpha: false, forceWebGL: options.forceWebGL ?? false });
  const startDpr = Math.min(devicePixelRatio || 1, tier.maxDpr, small ? 1.5 : 2);
  const governor = new ResolutionGovernor(tier, startDpr);
  renderer.setPixelRatio(governor.dpr);
  renderer.shadowMap.enabled = tier.shadows;
  renderer.shadowMap.type = PCFShadowMap;
  await renderer.init();
  const backend: WorldStats["backend"] = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl2";

  const canvas = renderer.domElement;
  canvas.className = "world-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const overlay = document.createElement("div");
  overlay.className = "world-overlay";
  container.append(canvas, overlay);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.4, 1600);
  const worldRoot = new Group();
  scene.add(worldRoot);
  const hemi = new HemisphereLight(0xffffff, 0x888888, 1);
  const sun = new DirectionalLight(0xffffff, 2);
  const sunTarget = new Object3D();
  sun.target = sunTarget;
  let shadows = tier.shadows;
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(hemi, sun, sunTarget);
  scene.fog = new Fog(0xffffff, 60, 300);

  const sky = new SkyDome(tier.name === "low" ? 300 : 900);
  const horizon = new Horizon();
  scene.add(sky.group, horizon.group);
  const land = new Land(worldRoot, SEED, shadows);
  const vegetation = new Vegetation(worldRoot, tier);
  const keep = new Keep(shadows, tier.lights);
  const knight = new Knight(shadows);
  const dog = new RobotDog(shadows);
  let colors = readThemeColors();
  const landmarks = new Landmarks((x, y) => land.heightAt(x, y), shadows);
  worldRoot.add(keep.group, knight.root, dog.root, landmarks.group);

  // ---------- the ground, as each kind of walker sees it ----------
  let stationObstacles: Obstacle[] = obstacles();
  let plotsNow: { x: number; y: number; size: number }[] = [];
  const height = (x: number, y: number): number => land.heightAt(x, y);
  const wet = (x: number, y: number): boolean => land.heightAt(x, y) < WATER_LEVEL + 0.05;
  const insideAny = (list: Obstacle[], x: number, y: number): boolean => {
    for (let i = 0; i < list.length; i++) if (Math.hypot(x - list[i]!.x, y - list[i]!.y) < list[i]!.r) return true;
    return false;
  };
  /** Galahad plans round buildings; underfoot he only refuses water and the giant tree. */
  const galahadGround: Ground = { height, blocked: (x, y) => wet(x, y) || Math.hypot(x, y) < 6 };
  const dogGround: Ground = { height, blocked: (x, y) => wet(x, y) || insideAny(stationObstacles, x, y) };
  const wildGround: Ground = {
    height,
    blocked: (x, y) => {
      if (wet(x, y) || Math.hypot(x, y) < KEEP_RADIUS + 6) return true;
      for (let i = 0; i < plotsNow.length; i++) if (onPlot(plotsNow[i]!, x, y, 5)) return true;
      return false;
    },
  };
  const fauna = new Fauna(worldRoot, tier, wildGround);
  const plots = new Plots(colors, shadows, fauna);
  const duckGround: Ground = {
    height,
    blocked: (x, y) => {
      if (wet(x, y) || insideAny(stationObstacles, x, y) || Math.hypot(x, y) < 8.5) return true;
      for (let i = 0; i < plotsNow.length; i++) if (onPlot(plotsNow[i]!, x, y, 3)) return true;
      return false;
    },
  };
  const critters = new Critters(worldRoot, tier.microducks, duckGround, shadows);
  const galahadLead = { x: 0, y: 0, heading: 0 };
  const dogLead = { x: 0, y: 0, heading: 0 };
  worldRoot.add(plots.group);

  const rig = new CameraRig();
  const walker = new Walker(standAt("keep"));
  let origin: [number, number] = [0, 0];
  const originScene = new Vector3();
  let model: WorldModel | null = null;
  let selected: string | null = null;
  let flatsKey = "";
  let dirty = true;
  let disposed = false;
  let lost = false;
  let override: number | null = null;
  const skyState = emptySky();

  let sparkTimer = 0;
  const anvil = forgeAnvil();
  const knightState: KnightState = { moving: false, running: false, working: false, thinking: false, armed: false };
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

  // ---------- sky, light and theme ----------
  function applySky(hours: number): void {
    skyAt(hours, skyState);
    const s = skyState;
    sky.set(s);
    horizon.set(s.light, s.horizon, s.night);
    (scene.fog as Fog).color.setHex(s.horizon);
    hemi.color.setHex(s.hemiSky);
    hemi.groundColor.setHex(s.hemiGround);
    hemi.intensity = s.hemiIntensity;
    sun.color.setHex(s.light);
    sun.intensity = s.lightIntensity;
    land.setWaterColor(s.water);
    keep.setNight(s.night);
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
    dirty = true;
  };
  motionQuery.addEventListener("change", motionChanged);
  const clock = () => {
    if (override !== null) return;
    applySky(localHours(new Date()));
  };
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
  const addLabel = (key: string, el: HTMLElement, point: (out: Vec3) => boolean, fade = 4.5): void => {
    labels.get(key)?.el.remove();
    el.style.visibility = "hidden";
    overlay.append(el);
    labels.set(key, { el, point, fade, x: Number.NaN, y: Number.NaN, shown: false });
  };
  const removeLabel = (key: string): void => {
    labels.get(key)?.el.remove();
    labels.delete(key);
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
  let walkKey = "";
  function retarget(m: WorldModel): void {
    const target = targetFor(m.galahad, m.experiments);
    const key = `${m.galahad.station}|${m.galahad.experiment}|${target.x.toFixed(2)},${target.y.toFixed(2)}`;
    if (key === walkKey) return;
    walkKey = key;
    walker.go(target, stationObstacles, reduced());
    dirty = true;
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

  /** The ground point (scene, relative to the origin) under a screen point, into `hit`. */
  function groundUnder(clientX: number, clientY: number): boolean {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(groundPlane, hit) !== null;
  }

  // ---------- hover labels: "Microduck (Pollen Robotics)", "SO-101 arm (LeRobot)" ----------
  const hoverLabel = div("world-label hover");
  hoverLabel.style.visibility = "hidden";
  overlay.append(hoverLabel);
  const hoverAt: [number, number] = [0, 0];
  const hoverPoint: Vec3 = [0, 0, 0];
  let hoverUntil = 0;
  let hoverShown = false;
  function probe(clientX: number, clientY: number): string | null {
    if (!groundUnder(clientX, clientY)) return null;
    return critters.hover(hit.x + origin[0], -hit.z + origin[1], hoverPoint);
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

  // ---------- the loop ----------
  const projected = new Vector3();
  const point: Vec3 = [0, 0, 0];
  function placeLabels(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const label of labels.values()) {
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
      const x = Math.round(((projected.x + 1) / 2) * w);
      const y = Math.round(((1 - projected.y) / 2) * h);
      if (!label.shown) {
        label.el.style.visibility = "visible";
        label.shown = true;
      }
      if (x !== label.x || y !== label.y) {
        label.x = x;
        label.y = y;
        label.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
      }
      label.el.style.opacity = opacity < 0.995 ? opacity.toFixed(2) : "1";
    }
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
    wind.value = motion ? 1 : 0;
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    let active = walker.step(dt, galahadGround);
    if (rig.follow) rig.lookAt(walker.x, walker.y);
    active = rig.update(dt, motion) || active;
    active = plots.animate(now, skyState.horizon) || active;
    const ambient = motion && now - lastRender >= idleInterval;
    if (!dirty && !active && !ambient) {
      renderedLast = false;
      return;
    }
    if (now - lastRender < 1000 / 61) return;
    const renderDt = Math.min(0.1, (now - lastRender) / 1000);
    // Only frames rendered back to back, at full rate, say anything about how long a frame takes.
    if (renderedLast && (active || dirty)) {
      const action = governor.frame(now, now - lastRender);
      if (action === "dpr") {
        renderer.setPixelRatio(governor.dpr);
        resize();
      } else if (action === "drop-shadows") setShadows(false);
      else if (action === "drop-grass") vegetation.dropGrass();
    }
    frames++;
    frameMsSum += now - lastRender;
    if (now - windowStart >= 1000) {
      fps = frames;
      frameMs = frames ? frameMsSum / frames : 0;
      frames = 0;
      frameMsSum = 0;
      windowStart = now;
    }
    lastRender = now;
    renderedLast = true;
    dirty = false;
    const t = now / 1000;

    // Floating origin: far from it, move it (and so the whole world) under the camera.
    if (Math.hypot(rig.x - origin[0], rig.y - origin[1]) > REBASE_M) {
      origin = [Math.round(rig.x / 64) * 64, Math.round(rig.y / 64) * 64];
      worldRoot.position.set(-origin[0], 0, origin[1]);
      originScene.set(origin[0], 0, -origin[1]);
      vegetation.place(originScene);
      fauna.place(originScene);
      critters.place(originScene);
      originUniform.value.set(origin[0], origin[1]);
    }
    const loadRadius = Math.min(tier.radius, Math.max(150, rig.distance * 1.7 + 70));
    if (land.update(rig.x, rig.y, loadRadius, tier.chunkBudget)) dirty = true;
    const fog = scene.fog as Fog;
    fog.far = loadRadius * 0.92;
    fog.near = Math.min(fog.far * 0.5, rig.distance * 1.2 + 20);

    // Galahad and his dog.
    const g = model?.galahad;
    const atWork = !walker.moving && Boolean(g?.doing);
    knightState.moving = walker.moving;
    knightState.running = walker.running;
    knightState.working = atWork;
    knightState.thinking = !walker.moving && Boolean(g?.model);
    knightState.armed = !walker.moving && (g?.station === "field" || g?.station === "forge");
    const gz = groundAt(walker.x, walker.y);
    // Characters sit in the world root at their absolute place (only instanced things are origin-relative).
    knight.root.position.set(walker.x, gz, -walker.y);
    knight.root.rotation.y = headingToSceneYaw(walker.heading);
    knight.animate(renderDt, t, knightState, motion);
    master.x = walker.x;
    master.y = walker.y;
    master.heading = walker.heading;
    master.moving = walker.moving;
    master.running = walker.running;
    master.working = atWork || knightState.thinking;
    dog.step(renderDt, t, master, dogGround, motion);
    dog.apply(groundAt(dog.x, dog.y), ZERO);
    keep.animate(t, motion);
    landmarks.animate(t, motion);

    // Sparks fly at the lab's workbench while he works there.
    if (motion && atWork && g?.station === "forge") {
      sparkTimer -= renderDt;
      if (sparkTimer <= 0) {
        sparkTimer = 0.28;

        fauna.sparksAt(anvil[0], anvil[1], anvil[2], 4);
      }
    }
    const dusk = Math.min(1, skyState.night * 1.4) * (skyState.hours > 17 || skyState.hours < 3 ? 1 : 0.4);
    fauna.step(renderDt, rig.x, rig.y, origin, skyState.night, dusk, motion);
    galahadLead.x = walker.x;
    galahadLead.y = walker.y;
    galahadLead.heading = walker.heading;
    dogLead.x = dog.x;
    dogLead.y = dog.y;
    dogLead.heading = dog.heading;
    critters.step(renderDt, t, galahadLead, dogLead, groundAt, atWork && g?.station === "forge", origin, motion);
    placeHover();

    const focusGround = Math.max(0, groundAt(rig.x, rig.y));
    rig.apply(camera, origin, focusGround);
    camera.updateMatrixWorld();
    vegetation.update(land, camera, rig.x, rig.y, origin);
    sky.follow(camera.position);
    horizon.follow(camera.position, t, motion);
    // The light: from the sun by day, the moon by night, kept over the focus.
    const dir = skyState.lightFromSun ? skyState.sun : skyState.moon;
    const fx = rig.x - origin[0];
    const fz = -(rig.y - origin[1]);
    sunTarget.position.set(fx, focusGround, fz);
    sun.position.set(fx + dir[0] * 90, focusGround + Math.max(0.15, dir[2]) * 90, fz - dir[1] * 90);
    if (shadows) {
      const r = rig.distance * 0.9 + 12;
      const cam = sun.shadow.camera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 1;
      cam.far = 260;
      cam.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    drawCalls = renderer.info.render.drawCalls;
    placeLabels();
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
          land.setFlats([KEEP_FLAT, ...next.experiments.map((e) => plotFlat(e.plot))]);
          dirty = true;
        }
        syncExperimentLabels(next);
        if (selected && !next.experiments.some((e) => e.id === selected)) options.onSelect(null);
      }
      if (!prev || prev.galahad !== next.galahad || prev.experiments !== next.experiments) retarget(next);
      if (!prev || prev.galahad !== next.galahad || prev.thoughts !== next.thoughts) {
        syncBubble(next);
        dirty = true;
      }
      if (!prev || prev.nodes !== next.nodes) {
        keep.setNodes(next.nodes);
        syncNodeLabels();
        dirty = true;
      }
      if (!prev) {
        // First sight: put him (and the dog) where he is at once, and the camera on him.
        walker.go(targetFor(next.galahad, next.experiments), stationObstacles, true);
        dog.place({ x: walker.x, y: walker.y, heading: walker.heading, moving: false, running: false, working: true });
        rig.lookAt(walker.x, walker.y);
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
        rig.lookAt(walker.x, walker.y, 26);
      } else {
        stopFollowing();
        if (target.kind === "station") {
          const s = STATIONS[target.station];
          rig.lookAt(s.x, s.y, 30);
        } else {
          const e = plots.get(target.id)?.exp;
          if (e) rig.lookAt(e.plot.x, e.plot.y, Math.max(30, e.plot.size * 1.7));
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
      dirty = true;
    },
    setTimeOfDay(hours) {
      override = hours;
      applySky(hours ?? localHours(new Date()));
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
      knight.dispose();
      dog.dispose();
      fauna.dispose();
      critters.dispose();
      plots.dispose();
      landmarks.dispose();
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

