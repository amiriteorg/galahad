import { ORB_MOVES, ORB_STAGES, ORB_STILL, orbBursts, orbClock, orbFrame, orbMoodOfState, orbSeed, orbStep, shownMotes, type OrbClock, type OrbFrame, type OrbMood, type OrbStage } from "../lib/orb-motion.ts";
import { orbLevel, orbPalette, orbParts, orbTone, orbToneOfState, type OrbInk, type OrbPalette, type OrbPart, type OrbStop, type OrbTone } from "../lib/orb.ts";
import { h, svg } from "./dom.ts";
import { motionAllowed, move } from "./motion.ts";

/*
 * Galahad as an orb (your word, 23 November 2026: "a Jarvis … like visual, the orb graphic", the one you talk to): the
 * parts lib/orb.ts gives, in the colour of his state (lib/now.ts's tone). Where he is doing something, it moves as his
 * mood does (lib/orb-motion.ts; your word, 24 November 2026: "pulsing/moving when doing a task, sitting idle, waiting,
 * done"). It is drawn on a canvas a frame at a time, its motes and waves reaching out past it. Still, as an answer in a
 * conversation's history shows him, and wherever motion is reduced, it is the same parts, unmoved. The Apple and
 * Android apps draw the same. Drawn from fixed shapes; nothing in it comes from a name, a profile or a model.
 */

export type { OrbTone };

export interface OrbOptions {
  /** Its width and height in CSS pixels (16 to 320; 36 when left out). */
  size?: number;
  tone?: OrbTone;
  /** Its accessible name ("Galahad: at work"). Leave it out beside the word "Galahad": the orb is then decorative. */
  label?: string;
  /** What he is doing: it moves as that mood does while motion is allowed. Left out: still. */
  mood?: OrbMood;
  /** Which orb it is, so one drawn again (a new state, its page drawn anew) carries on where it was, and a change of mood
   * fades or bursts rather than starting afresh. His own when left out: all his orbs move as one. */
  key?: string;
}

let drawn = 0;

export function orb(options: OrbOptions = {}): HTMLElement {
  const size = Number.isFinite(options.size) ? Math.round(Math.max(16, Math.min(320, options.size!))) : 36;
  const tone = orbTone(options.tone);
  const named = options.label ? { role: "img", "aria-label": options.label } : { "aria-hidden": "true" };
  if (options.mood) {
    const live = liveCanvas(size, tone, options.mood, options.key ?? "galahad");
    if (live) return h("span", { class: "orb orb-live", "data-tone": tone, "data-mood": options.mood, style: `--orb-size:${size}px`, ...named }, live);
  }
  const palette = orbPalette(tone);
  // Each orb's gradients have names of their own: two on one page (his line, the welcome) never share one.
  const id = `orb-${++drawn}`;
  const defs: SVGElement[] = [];
  const shapes = orbParts(size).map((part, n) => shape(part, `${id}-${n}`, palette, defs));
  return h(
    "span",
    { class: "orb", "data-tone": tone, style: `--orb-size:${size}px`, ...named },
    svg("svg", { viewBox: "-100 -100 200 200", focusable: "false" }, svg("defs", {}, ...defs), ...shapes),
  );
}

/**
 * The lights round a knight's face in its seat (ui/avatar.ts' seat): its ring's glow breathing, the light running round
 * it, its waves and its motes, in its state's colour, over the still ring the stylesheet draws. `box` is the seat's width
 * and `ring` its ring's, in CSS pixels. None where there's no canvas to draw on.
 */
export function seatLights(options: { box: number; ring: number; state: string | undefined; key: string }): HTMLCanvasElement | null {
  const stage = ORB_STAGES.ring;
  const prepared = canvasFor(options.box, stage);
  if (!prepared) return null;
  const { canvas, g, k } = prepared;
  canvas.className = "seat-lights";
  const mood = orbMoodOfState(options.state);
  const palette = orbPalette(orbToneOfState(options.state));
  const seed = orbSeed(options.key);
  const kept = keep(`seat:${options.key}`, mood, seed);
  // The ring in the units the stage is drawn in: 100 is its outer edge.
  const width = (options.ring * 200) / options.box;
  const r = 100 - width / 2;
  const draw = (t: number, moving: boolean) => {
    clear(g, canvas, k);
    if (!moving) return;
    const frame = advance(kept, t, seed);
    const glow = frame.aura;
    if (glow > 0.005) {
      // A bloom, then a closer glow: the ring's own light, swelling and fading with its breath.
      stroke(g, r, width * 6, rgba(palette.tint, glow * 0.28));
      stroke(g, r, width * 2.6, rgba(palette.tint, glow * 0.6));
    }
    waves(g, frame, stage, palette);
    if (frame.comet) comet(g, frame.comet, r, Math.max(width * 1.6, 3), palette);
    motes(g, shownMotes(frame, stage), stage, palette);
  };
  draw(now(), motionAllowed());
  move(canvas, draw, 30);
  return canvas;
}

// ---- each orb's own course: its mood, the one before, when it changed, and its clock, kept by its key --------------

interface Kept {
  mood: OrbMood;
  from: OrbMood | null;
  /** When it arrived at its mood, in seconds; never, on first sight. */
  at: number;
  burst: boolean;
  clock: OrbClock;
  /** The moment its clock was last stepped to. */
  last: number;
}

const kept = new Map<string, Kept>();
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/** An orb's course, by its key: begun settled on first sight; on a new mood, the change starts now. */
function keep(key: string, mood: OrbMood, seed: number): Kept {
  let course = kept.get(key);
  if (!course) {
    course = { mood, from: null, at: Number.NEGATIVE_INFINITY, burst: false, clock: orbClock(mood, seed), last: now() };
    kept.set(key, course);
  } else if (course.mood !== mood) {
    Object.assign(course, { from: course.mood, burst: orbBursts(course.mood, mood), mood, at: now() });
  }
  return course;
}

/** Its frame at `t`, its clock stepped on to it first (once a moment, however many of its orbs are drawn). */
function advance(course: Kept, t: number, seed: number): OrbFrame {
  if (t > course.last) {
    course.clock = orbStep(course.clock, course.mood, t - course.last);
    course.last = t;
  }
  const since = Number.isFinite(course.at) ? t - course.at : null;
  return orbFrame(course.mood, course.clock, t, { seed, since, from: course.from, burst: course.burst });
}

// ---- drawing on a canvas -------------------------------------------------------------------------------------------

/** A canvas for an orb or a seat `size` CSS pixels wide, wide enough for its stage's reach, sharp on this screen: its
 * context, and `k`, device pixels to a unit of the orb's square. */
function canvasFor(size: number, stage: OrbStage): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; k: number } | null {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const canvas = document.createElement("canvas");
  const g = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (!g) return null;
  const css = Math.ceil((size * stage.reach) / 100);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(css * dpr);
  canvas.style.width = canvas.style.height = `${css}px`;
  canvas.setAttribute("aria-hidden", "true");
  return { canvas, g, k: ((size / 200) * canvas.width) / css };
}

function clear(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, k: number): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(k, 0, 0, k, canvas.width / 2, canvas.height / 2);
}

function liveCanvas(size: number, tone: OrbTone, mood: OrbMood, key: string): HTMLCanvasElement | null {
  const level = orbLevel(size);
  const stage = ORB_STAGES[level];
  const prepared = canvasFor(size, stage);
  if (!prepared) return null;
  const { canvas, g, k } = prepared;
  canvas.className = "orb-canvas";
  const parts = orbParts(size);
  const palette = orbPalette(tone);
  const seed = key === "galahad" ? 0 : orbSeed(key);
  const course = keep(key, mood, seed);
  const draw = (t: number, moving: boolean) => {
    clear(g, canvas, k);
    paint(g, parts, palette, moving ? advance(course, t, seed) : ORB_STILL, stage);
  };
  draw(now(), motionAllowed());
  // His welcome's at every frame; a smaller one needs no more than half.
  move(canvas, draw, level === "full" ? 60 : 30);
  return canvas;
}

/** The orb's parts as a frame moves them, with its lights among them (lib/orb-motion.ts' ORB_MOVES). */
function paint(g: CanvasRenderingContext2D, parts: readonly OrbPart[], palette: OrbPalette, frame: OrbFrame, stage: OrbStage): void {
  const has = (list: readonly string[], name: string) => list.includes(name);
  if (!parts.some((part) => part.name === "halo")) waves(g, frame, stage, palette);
  for (const part of parts) {
    if (part.name === ORB_MOVES.lightsBefore) {
      if (frame.comet && stage.comet) comet(g, frame.comet, stage.comet.r, stage.comet.width, palette);
      motes(g, shownMotes(frame, stage), stage, palette);
    }
    g.save();
    const turn = has(ORB_MOVES.ring, part.name) ? frame.ring : has(ORB_MOVES.ticks, part.name) ? frame.ticks : has(ORB_MOVES.segments, part.name) ? frame.segments : 0;
    if (turn) g.rotate((turn * Math.PI) / 180);
    if (has(ORB_MOVES.swell, part.name) && frame.scale !== 1) g.scale(frame.scale, frame.scale);
    paintPart(g, part, palette, has(ORB_MOVES.glow, part.name) ? frame.glow : 1);
    g.restore();
    if (part.name === "halo") waves(g, frame, stage, palette);
  }
}

/** One part, as the SVG has it: a radial gradient in its box, a ring's arcs from the top, ticks, a lit rim, a shine. */
function paintPart(g: CanvasRenderingContext2D, part: OrbPart, palette: OrbPalette, glow: number): void {
  const ink = (name: OrbInk) => (name === "white" ? "#ffffff" : palette[name]);
  const gradient = (made: CanvasGradient, stops: readonly OrbStop[]) => {
    for (const s of stops) made.addColorStop(s.at, rgba(ink(s.ink), Math.min(1, s.opacity * glow)));
    return made;
  };
  switch (part.kind) {
    case "disc": {
      // As SVG's radial gradient in its box: lit from (cx, cy) of the box, reaching `spread` of its width.
      const [cx, cy] = [-part.r + part.cx * 2 * part.r, -part.r + part.cy * 2 * part.r];
      g.fillStyle = gradient(g.createRadialGradient(cx, cy, 0, cx, cy, part.spread * 2 * part.r), part.stops);
      g.beginPath();
      g.arc(0, 0, part.r, 0, 2 * Math.PI);
      g.fill();
      return;
    }
    case "ring":
      g.beginPath();
      if (!part.arcs) g.arc(0, 0, part.r, 0, 2 * Math.PI);
      // (Degrees from the top, clockwise: the canvas's own start at three o'clock, y down.)
      else for (const [from, to] of part.arcs) {
        const [x, y] = at(part.r, from);
        g.moveTo(x, y);
        g.arc(0, 0, part.r, radians(from - 90), radians(to - 90));
      }
      g.lineCap = "butt";
      g.lineWidth = part.width;
      g.strokeStyle = rgba(ink(part.ink), part.opacity);
      g.stroke();
      return;
    case "ticks":
      g.beginPath();
      for (let i = 0; i < part.count; i++) {
        const angle = part.offset + (360 * i) / part.count;
        g.moveTo(...at(part.r - part.length / 2, angle));
        g.lineTo(...at(part.r + part.length / 2, angle));
      }
      g.lineCap = "butt";
      g.lineWidth = part.width;
      g.strokeStyle = rgba(ink(part.ink), part.opacity);
      g.stroke();
      return;
    case "rim":
      g.beginPath();
      g.arc(0, 0, part.r, 0, 2 * Math.PI);
      g.lineWidth = part.width;
      g.strokeStyle = gradient(g.createLinearGradient(part.from[0], part.from[1], part.to[0], part.to[1]), part.stops);
      g.stroke();
      return;
    case "shine":
      g.translate(part.cx, part.cy);
      g.rotate(radians(part.rotate));
      g.beginPath();
      g.ellipse(0, 0, part.rx, part.ry, 0, 0, 2 * Math.PI);
      g.fillStyle = rgba("#ffffff", part.opacity);
      g.fill();
      return;
  }
}

/** Its waves: rings of its light going out from its edge, thinning and fading as they go. */
function waves(g: CanvasRenderingContext2D, frame: OrbFrame, stage: OrbStage, palette: OrbPalette): void {
  for (const gone of frame.ripples) stroke(g, stage.waves[0] + gone * (stage.waves[1] - stage.waves[0]), stage.wave * (1 - 0.6 * gone), rgba(palette.tint, 0.6 * (1 - gone) ** 2));
}

/** Its light: a head of white running round `r`, its tail in the lit tint, fading and thinning behind it. */
const TAIL_STEPS = 18;
function comet(g: CanvasRenderingContext2D, light: { head: number; tail: number; alpha: number }, r: number, width: number, palette: OrbPalette): void {
  g.lineCap = "round";
  for (let j = 0; j < TAIL_STEPS; j++) {
    const along = (j + 1) / TAIL_STEPS;
    const from = light.head - light.tail + (j * light.tail) / TAIL_STEPS;
    g.beginPath();
    g.arc(0, 0, r, radians(from - 90), radians(from + light.tail / TAIL_STEPS - 90));
    g.lineWidth = width * (0.35 + 0.65 * along);
    g.strokeStyle = rgba(palette.light, light.alpha * along ** 1.6);
    g.stroke();
  }
  const [x, y] = at(r, light.head);
  g.globalAlpha = light.alpha;
  g.drawImage(sprite(palette), x - width * 2.2, y - width * 2.2, width * 4.4, width * 4.4);
  g.globalAlpha = 1;
}

/** Its motes, each a point of light with a glow round it, where the frame puts them in the stage's band. */
function motes(g: CanvasRenderingContext2D, shown: readonly { angle: number; u: number; size: number; alpha: number }[], stage: OrbStage, palette: OrbPalette): void {
  if (!shown.length) return;
  const dot = sprite(palette);
  for (const mote of shown) {
    if (mote.alpha <= 0.01) continue;
    const [x, y] = at(stage.band[0] + mote.u * (stage.band[1] - stage.band[0]), mote.angle);
    const reach = stage.mote * mote.size * 2;
    g.globalAlpha = mote.alpha;
    g.drawImage(dot, x - reach, y - reach, 2 * reach, 2 * reach);
  }
  g.globalAlpha = 1;
}

/** A point of light in a palette, drawn once: white at its heart, its lit tint, then its glow fading to nothing. */
const sprites = new Map<string, HTMLCanvasElement>();
function sprite(palette: OrbPalette): HTMLCanvasElement {
  let made = sprites.get(palette.tint);
  if (made) return made;
  made = document.createElement("canvas");
  made.width = made.height = 64;
  const g = made.getContext("2d")!;
  const glow = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, rgba("#ffffff", 1));
  glow.addColorStop(0.18, rgba(palette.light, 0.95));
  glow.addColorStop(0.45, rgba(palette.tint, 0.4));
  glow.addColorStop(1, rgba(palette.tint, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, 64, 64);
  sprites.set(palette.tint, made);
  return made;
}

function stroke(g: CanvasRenderingContext2D, r: number, width: number, color: string): void {
  g.beginPath();
  g.arc(0, 0, r, 0, 2 * Math.PI);
  g.lineWidth = width;
  g.strokeStyle = color;
  g.stroke();
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
/** The point `r` from the middle at `angle` degrees clockwise from the top (y down). */
const at = (r: number, angle: number): [number, number] => [r * Math.sin(radians(angle)), -r * Math.cos(radians(angle))];

const rgbs = new Map<string, string>();
function rgba(hex: string, alpha: number): string {
  let rgb = rgbs.get(hex);
  if (!rgb) rgbs.set(hex, (rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")));
  return `rgba(${rgb},${Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000})`;
}

/** One part as SVG; a gradient it fills or strokes with goes into `defs`, named `id`. */
function shape(part: OrbPart, id: string, palette: OrbPalette, defs: SVGElement[]): SVGElement {
  const ink = (name: OrbInk): string => (name === "white" ? "#ffffff" : palette[name]);
  const stops = (list: readonly OrbStop[]) => list.map((s) => svg("stop", { offset: String(s.at), "stop-color": ink(s.ink), "stop-opacity": String(s.opacity) }));
  const named = { class: `orb-${part.name}` };
  switch (part.kind) {
    case "disc":
      defs.push(svg("radialGradient", { id, cx: String(part.cx), cy: String(part.cy), r: String(part.spread) }, ...stops(part.stops)));
      return svg("circle", { ...named, r: String(part.r), fill: `url(#${id})` });
    case "ring": {
      const stroke = { ...named, fill: "none", stroke: ink(part.ink), "stroke-width": String(part.width), opacity: String(part.opacity) };
      if (!part.arcs) return svg("circle", { ...stroke, r: String(part.r) });
      return svg("path", { ...stroke, d: part.arcs.map(([from, to]) => `M${point(part.r, from)}A${part.r} ${part.r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(part.r, to)}`).join("") });
    }
    case "ticks": {
      const d = Array.from({ length: part.count }, (_, i) => part.offset + (360 * i) / part.count)
        .map((angle) => `M${point(part.r - part.length / 2, angle)}L${point(part.r + part.length / 2, angle)}`)
        .join("");
      return svg("path", { ...named, d, fill: "none", stroke: ink(part.ink), "stroke-width": String(part.width), opacity: String(part.opacity) });
    }
    case "rim":
      defs.push(svg("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: String(part.from[0]), y1: String(part.from[1]), x2: String(part.to[0]), y2: String(part.to[1]) }, ...stops(part.stops)));
      return svg("circle", { ...named, r: String(part.r), fill: "none", stroke: `url(#${id})`, "stroke-width": String(part.width) });
    case "shine":
      return svg("ellipse", { ...named, cx: String(part.cx), cy: String(part.cy), rx: String(part.rx), ry: String(part.ry), fill: "#ffffff", opacity: String(part.opacity), transform: `rotate(${part.rotate} ${part.cx} ${part.cy})` });
  }
}

/** The point `r` from the middle at `angle` degrees clockwise from the top, as SVG takes it ("x y", y down). */
function point(r: number, angle: number): string {
  const radians = (angle * Math.PI) / 180;
  const round = (n: number) => String(Math.round(n * 1000) / 1000);
  return `${round(r * Math.sin(radians))} ${round(-r * Math.cos(radians))}`;
}
