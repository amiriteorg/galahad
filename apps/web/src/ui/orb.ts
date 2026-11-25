import { ORB_MOVES, ORB_STAGES, ORB_STILL, orbBursts, orbClock, orbFps, orbFrame, orbMoodOfState, orbSeed, orbStep, shownMotes, type OrbClock, type OrbFrame, type OrbMood, type OrbStage } from "../lib/orb-motion.ts";
import { orbLevel, orbPalette, orbParts, orbTone, orbToneOfState, type OrbInk, type OrbPalette, type OrbPart, type OrbStop, type OrbTone } from "../lib/orb.ts";
import { dataGlyph, KNIGHT_SPHERE, knightArcs, orbSphere, paperShades, SPHERE_TURN, sphereFrame, spherePoints, sphereShades, type ShownGlyph } from "../lib/orb-sphere.ts";
import { blendHex, knightColors } from "@galahad/core/avatar";
import { h, svg } from "./dom.ts";
import { motionAllowed, move } from "./motion.ts";

/*
 * Galahad as an orb (your word, 23 November 2026: "a Jarvis … like visual, the orb graphic", the one you talk to): the
 * parts lib/orb.ts gives, in the colour of his state (lib/now.ts's tone), his sphere of points of light among them.
 * Where he is doing something, it moves as his mood does (lib/orb-motion.ts; your word, 24 November 2026:
 * "pulsing/moving when doing a task, sitting idle, waiting, done"): it is drawn on a canvas a frame at a time, its
 * sphere turning, its motes and waves reaching out past it. Still, as an answer in a conversation's history shows him,
 * and wherever motion is reduced, it is the same parts, unmoved. A knight's face is a sphere too, in its own colours
 * (knightFace; your word, 25 November 2026). The Apple and Android apps draw the same. Nothing in it comes from a name's
 * meaning, a profile's words or a model: a knight's colour is one you chose or its handle's, and its handle seeds its
 * sphere.
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
  move(canvas, draw, () => orbFps(kept.mood, "ring", since(kept)));
  return canvas;
}

/** A knight's face options: whose (its handle), its saved avatar (a colour you chose for it, core's knightColors), its
 * size in CSS pixels, and its mood (lib/orb-motion.ts; left out, still: as a speaker in a conversation's history). */
export interface KnightFaceOptions {
  id: string;
  profile?: unknown;
  size: number;
  mood?: OrbMood;
  /** Its accessible name; left out, it is decorative (its name is beside it). */
  label?: string;
  /** Which course it moves on (a seat's face shares its seat's lights' course, `seat:<handle>`). */
  key?: string;
}

/**
 * A knight's face: its sphere of glyphs round a bright nucleus, in its own colours, with an arc or two of its own turning
 * round it (your words, 25 November 2026: "custom/procedurally generated colored particle orbs", "glyph and randomness
 * … like Jarvis/Ultron", "slow and calming movement"). Its colour is one you chose or its handle's, and its sphere and
 * arcs its handle's (lib/orb-sphere.ts): every knight's is its own, the same on every device. In a mood it turns and
 * breathes as its seat's lights do, on the same course (the seat's key), so its face and its ring move as one; still,
 * and wherever motion is reduced, it is drawn once.
 */
export function knightFace(options: KnightFaceOptions): HTMLElement {
  const size = Number.isFinite(options.size) ? Math.round(Math.max(16, Math.min(256, options.size))) : 40;
  const id = String(options.id ?? "");
  const colors = knightColors(id, options.profile);
  const level = orbLevel(size);
  const look = KNIGHT_SPHERE[level];
  const sphere = orbSphere(id);
  const points = spherePoints(sphere, look.count);
  const arcs = knightArcs(sphere, level);
  const secondLight = blendHex(colors.second, "#ffffff", 0.45);
  const secondDeep = blendHex(colors.second, "#000000", 0.52);
  const inks = (onPaper: boolean) =>
    onPaper
      ? { tint: paperShades(colors.tint, colors.deep), second: paperShades(colors.second, secondDeep), line: colors.deep, heart: colors.deep }
      : { tint: sphereShades(colors.tint, colors.light, colors.deep), second: sphereShades(colors.second, secondLight, secondDeep), line: colors.light, heart: "#fff8eb" };
  const named = options.label ? { role: "img", "aria-label": options.label } : { "aria-hidden": "true" };
  const box = { class: "knight-orb", style: `--orb-size:${size}px`, "data-tint": colors.tint, ...named };
  const prepared = options.mood ? canvasFor(size, ORB_STAGES.badge, 100) : null;
  if (prepared && options.mood) {
    const { canvas, g, k } = prepared;
    canvas.className = "knight-orb-canvas";
    const seed = orbSeed(id);
    const course = keep(options.key ?? `face:${id}`, options.mood, seed);
    const draw = (t: number, moving: boolean) => {
      clear(g, canvas, k);
      const frame = moving ? advance(course, t, seed) : ORB_STILL;
      const onPaper = paper();
      const ink = inks(onPaper);
      g.globalAlpha = Math.min(1, frame.glow) * (onPaper ? 0.6 : 1);
      g.fillStyle = faceLight(g, colors.tint);
      g.fillRect(-100, -100, 200, 200);
      g.globalAlpha = 1;
      for (const arc of arcs) {
        const from = arc.from + arc.speed * frame.ring;
        g.beginPath();
        g.arc(0, 0, arc.r, radians(from - 90), radians(from + arc.length - 90));
        g.lineWidth = arc.width;
        g.lineCap = "round";
        g.strokeStyle = rgba(ink.line, 0.5);
        g.stroke();
      }
      heart(g, look.nucleus * 2.2 * frame.scale, ink.heart, colors.tint, frame.glow);
      glyphs(g, sphereFrame(sphere, points, { angle: SPHERE_TURN * frame.ring, radius: look.r, scale: frame.scale, glyph: look.glyph, t: moving ? t : 0, mood: moving ? course.mood : "idle", paper: onPaper }), ink);
    };
    draw(now(), motionAllowed());
    move(canvas, draw, () => orbFps(course.mood, level, since(course)));
    return h("span", box, canvas);
  }
  const ink = inks(paper());
  const glowId = `orb-${++drawn}`;
  const heartId = `orb-${++drawn}`;
  return h(
    "span",
    box,
    svg(
      "svg",
      { viewBox: "-100 -100 200 200", focusable: "false" },
      svg(
        "defs",
        {},
        svg("radialGradient", { id: glowId }, svg("stop", { offset: "0", "stop-color": colors.tint, "stop-opacity": "0.42" }), svg("stop", { offset: "0.55", "stop-color": colors.tint, "stop-opacity": "0.16" }), svg("stop", { offset: "1", "stop-color": colors.tint, "stop-opacity": "0" })),
        svg("radialGradient", { id: heartId }, svg("stop", { offset: "0", "stop-color": ink.heart, "stop-opacity": "0.95" }), svg("stop", { offset: "0.3", "stop-color": colors.tint, "stop-opacity": "0.65" }), svg("stop", { offset: "1", "stop-color": colors.tint, "stop-opacity": "0" })),
      ),
      svg("circle", { r: "96", fill: `url(#${glowId})` }),
      ...arcs.map((arc) => svg("path", { d: `M${point(arc.r, arc.from)}A${arc.r} ${arc.r} 0 ${arc.length > 180 ? 1 : 0} 1 ${point(arc.r, arc.from + arc.length)}`, fill: "none", stroke: ink.line, "stroke-width": String(arc.width), "stroke-linecap": "round", opacity: "0.5" })),
      svg("circle", { r: String(look.nucleus * 2.2), fill: `url(#${heartId})` }),
      ...stillGlyphs(sphereFrame(sphere, points, { angle: 0, radius: look.r, scale: 1, glyph: look.glyph, t: 0, mood: "idle", paper: paper() }), ink),
    ),
  );
}

/** The light a face sits in, made once a context. */
const faceLights = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>();
function faceLight(g: CanvasRenderingContext2D, tint: string): CanvasGradient {
  let made = faceLights.get(g)?.get(tint);
  if (made) return made;
  made = g.createRadialGradient(0, 0, 0, 0, 0, 96);
  for (const [at, alpha] of [[0, 0.42], [0.55, 0.16], [1, 0]] as const) made.addColorStop(at, rgba(tint, alpha));
  if (!faceLights.has(g)) faceLights.set(g, new Map());
  faceLights.get(g)!.set(tint, made);
  return made;
}

/** The bright nucleus (Phren's): `heart` at its middle (white on a dark page, the deep tint on a light one), into the
 * tint, and gone, `r` across. */
function heart(g: CanvasRenderingContext2D, r: number, heartInk: string, tint: string, glow: number): void {
  const made = g.createRadialGradient(0, 0, 0, 0, 0, r);
  made.addColorStop(0, rgba(heartInk, Math.min(1, 0.95 * glow)));
  made.addColorStop(0.3, rgba(tint, Math.min(1, 0.65 * glow)));
  made.addColorStop(1, rgba(tint, 0));
  g.fillStyle = made;
  g.beginPath();
  g.arc(0, 0, r, 0, 2 * Math.PI);
  g.fill();
}

/** Whether the page is light (the app's theme, or the device's when it follows the device): glyphs are ink on paper
 * there. */
function paper(): boolean {
  if (typeof document === "undefined" || !document.documentElement?.dataset) return false;
  const theme = document.documentElement.dataset.theme;
  if (theme === "light" || theme === "dark") return theme === "light";
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
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
  return orbFrame(course.mood, course.clock, t, { seed, since: since(course, t), from: course.from, burst: course.burst });
}

/** Seconds since it arrived at its mood; null on first sight, settled. */
const since = (course: Kept, t = now()): number | null => (Number.isFinite(course.at) ? t - course.at : null);

// ---- drawing on a canvas -------------------------------------------------------------------------------------------

/** A canvas for an orb or a seat `size` CSS pixels wide, wide enough for its stage's reach, sharp on this screen: its
 * context, and `k`, device pixels to a unit of the orb's square. */
function canvasFor(size: number, stage: OrbStage, reach = stage.reach): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; k: number } | null {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const canvas = document.createElement("canvas");
  const g = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (!g) return null;
  const css = Math.ceil((size * reach) / 100);
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
  const palette = orbPalette(tone);
  const parts = orbParts(size).map((part) => prepare(g, part, palette));
  const seed = key === "galahad" ? 0 : orbSeed(key);
  const course = keep(key, mood, seed);
  const draw = (t: number, moving: boolean) => {
    clear(g, canvas, k);
    paint(g, parts, palette, moving ? advance(course, t, seed) : ORB_STILL, stage, { t: moving ? t : 0, mood: moving ? course.mood : "idle", paper: paper() });
  };
  draw(now(), motionAllowed());
  move(canvas, draw, () => orbFps(course.mood, level, since(course)));
  return canvas;
}

/**
 * A part ready to draw a frame at a time: its shape and its paint made once (a path, a gradient in the orb's units), so
 * a frame only turns, swells and fills them. What brightens with the glow (the halo, the core) is painted anew with
 * each frame's glow.
 */
interface Ready {
  name: string;
  turn: "ring" | "ticks" | "segments" | null;
  swells: boolean;
  draw: (g: CanvasRenderingContext2D, frame: OrbFrame, moment: Moment) => void;
}

/** When a frame is drawn: the time its glyphs change by, its mood, and whether the page is light. */
interface Moment {
  t: number;
  mood: OrbMood;
  paper: boolean;
}

function prepare(g: CanvasRenderingContext2D, part: OrbPart, palette: OrbPalette): Ready {
  const has = (list: readonly string[]) => list.includes(part.name);
  const turn = has(ORB_MOVES.ring) ? "ring" : has(ORB_MOVES.ticks) ? "ticks" : has(ORB_MOVES.segments) ? "segments" : null;
  // (On a light page his white is his deep tint: a white heart there would be a hole in the paper.)
  const ink = (name: OrbInk, onPaper = false) => (name === "white" ? (onPaper ? palette.deep : "#ffffff") : palette[name]);
  const gradient = (made: CanvasGradient, stops: readonly OrbStop[], glow: number, onPaper = false) => {
    for (const s of stops) made.addColorStop(s.at, rgba(ink(s.ink, onPaper), Math.min(1, s.opacity * glow)));
    return made;
  };
  const ready = (draw: Ready["draw"]): Ready => ({ name: part.name, turn, swells: has(ORB_MOVES.swell), draw });
  switch (part.kind) {
    case "disc": {
      // As SVG's radial gradient in its box: lit from (cx, cy) of the box, reaching `spread` of its width.
      const [cx, cy] = [-part.r + part.cx * 2 * part.r, -part.r + part.cy * 2 * part.r];
      const shape = path((p) => p.arc(0, 0, part.r, 0, 2 * Math.PI));
      const paint = (glow: number, onPaper: boolean) => gradient(g.createRadialGradient(cx, cy, 0, cx, cy, part.spread * 2 * part.r), part.stops, glow, onPaper);
      const still = [paint(1, false), paint(1, true)] as const;
      return ready((g, frame, moment) => {
        g.fillStyle = has(ORB_MOVES.glow) && frame.glow !== 1 ? paint(frame.glow, moment.paper) : still[moment.paper ? 1 : 0];
        fill(g, shape);
      });
    }
    case "ring": {
      const shape = path((p) => {
        if (!part.arcs) return p.arc(0, 0, part.r, 0, 2 * Math.PI);
        // (Degrees from the top, clockwise: the canvas's own start at three o'clock, y down.)
        for (const [from, to] of part.arcs) {
          p.moveTo(...at(part.r, from));
          p.arc(0, 0, part.r, radians(from - 90), radians(to - 90));
        }
      });
      const color = rgba(ink(part.ink), part.opacity);
      return ready((g) => strokeWith(g, shape, part.width, color, "butt"));
    }
    case "ticks": {
      const shape = path((p) => {
        for (let i = 0; i < part.count; i++) {
          const angle = part.offset + (360 * i) / part.count;
          p.moveTo(...at(part.r - part.length / 2, angle));
          p.lineTo(...at(part.r + part.length / 2, angle));
        }
      });
      const color = rgba(ink(part.ink), part.opacity);
      return ready((g) => strokeWith(g, shape, part.width, color, "butt"));
    }
    case "glyphs": {
      // His data ring: hex digits in about `share` of its places, each changing on a slow beat of its own, upright to
      // the ring as a dial's numbers are.
      const seed = orbSeed("galahad");
      return ready((g, _frame, moment) => {
        const color = moment.paper ? palette.deep : ink(part.ink);
        for (let k = 0; k < part.count; k++) {
          const lit = dataGlyph(seed, k, moment.t, part.share);
          if (!lit) continue;
          const angle = (360 * k) / part.count;
          const [x, y] = at(part.r, angle);
          g.save();
          g.translate(x, y);
          g.rotate(radians(angle));
          g.globalAlpha = lit.alpha;
          drawGlyph(g, lit.char, color, true, 0, 0, part.size);
          g.restore();
        }
        g.globalAlpha = 1;
      });
    }
    case "sphere": {
      // His own sphere, turning as his ring does, three times as far.
      const sphere = orbSphere("galahad");
      const points = spherePoints(sphere, part.count);
      const dark = { tint: sphereShades(palette.tint, palette.light, palette.deep), second: sphereShades(ink(part.second), ink(part.second), palette.light) };
      const light = { tint: paperShades(palette.tint, palette.deep), second: paperShades(palette.deep, blendHex(palette.deep, "#000000", 0.4)) };
      return ready((g, frame, moment) => glyphs(g, sphereFrame(sphere, points, { angle: SPHERE_TURN * frame.ring, radius: part.r, scale: 1, glyph: part.glyph, t: moment.t, mood: moment.mood, paper: moment.paper }), moment.paper ? light : dark));
    }
  }
}

/** The orb's parts as a frame moves them, with its lights among them (lib/orb-motion.ts' ORB_MOVES). */
function paint(g: CanvasRenderingContext2D, parts: readonly Ready[], palette: OrbPalette, frame: OrbFrame, stage: OrbStage, moment: Moment): void {
  if (!parts.some((part) => part.name === "halo")) waves(g, frame, stage, palette);
  for (const part of parts) {
    if (part.name === ORB_MOVES.lightsBefore) {
      if (frame.comet && stage.comet) comet(g, frame.comet, stage.comet.r, stage.comet.width, palette);
      motes(g, shownMotes(frame, stage), stage, palette);
    }
    const turn = part.turn ? frame[part.turn] : 0;
    const swell = part.swells && frame.scale !== 1;
    if (turn || swell) {
      g.save();
      if (turn) g.rotate(radians(turn));
      if (swell) g.scale(frame.scale, frame.scale);
    }
    part.draw(g, frame, moment);
    if (turn || swell) g.restore();
    if (part.name === "halo") waves(g, frame, stage, palette);
  }
}

/** A shape made once: a Path2D where the page has them, else drawn again each time on the context's own path. */
type Shape = Path2D | ((g: CanvasRenderingContext2D) => void);
function path(trace: (p: Path2D | CanvasRenderingContext2D) => void): Shape {
  if (typeof Path2D === "function") {
    const made = new Path2D();
    trace(made);
    return made;
  }
  return (g) => {
    g.beginPath();
    trace(g);
  };
}
function fill(g: CanvasRenderingContext2D, shape: Shape): void {
  if (typeof shape === "function") {
    shape(g);
    g.fill();
  } else g.fill(shape);
}
function strokeWith(g: CanvasRenderingContext2D, shape: Shape, width: number, style: string | CanvasGradient, cap: CanvasLineCap): void {
  g.lineCap = cap;
  g.lineWidth = width;
  g.strokeStyle = style;
  if (typeof shape === "function") {
    shape(g);
    g.stroke();
  } else g.stroke(shape);
}

/** Its waves: rings of its light going out from its edge, thinning and fading as they go. */
function waves(g: CanvasRenderingContext2D, frame: OrbFrame, stage: OrbStage, palette: OrbPalette): void {
  for (const gone of frame.ripples) stroke(g, stage.waves[0] + gone * (stage.waves[1] - stage.waves[0]), stage.wave * (1 - 0.6 * gone), rgba(palette.tint, 0.6 * (1 - gone) ** 2));
}

/**
 * Its light: a head of white running round `r`, its tail in the lit tint, fading (as how far along it is to the power
 * 1.6) and thinning (to 0.35 of its width) behind it. The tail is one shape, its light laid round the middle (a conic
 * gradient): drawn as 18 strokes, as it was, each was a draw of its own, every frame.
 */
const TAIL_STEPS = 18;
const FADE = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
function comet(g: CanvasRenderingContext2D, light: { head: number; tail: number; alpha: number }, r: number, width: number, palette: OrbPalette): void {
  const from = light.head - light.tail;
  if (light.tail > 0.5 && light.alpha > 0.005) {
    const half = (along: number) => (width * (0.35 + 0.65 * along)) / 2;
    g.beginPath();
    for (let j = 0; j <= TAIL_STEPS; j++) g.lineTo(...at(r + half(j / TAIL_STEPS), from + (j * light.tail) / TAIL_STEPS));
    for (let j = TAIL_STEPS; j >= 0; j--) g.lineTo(...at(r - half(j / TAIL_STEPS), from + (j * light.tail) / TAIL_STEPS));
    g.closePath();
    g.fillStyle = typeof g.createConicGradient === "function" ? fade(g, from, light, palette) : rgba(palette.light, light.alpha * 0.4);
    g.fill();
  }
  const [x, y] = at(r, light.head);
  g.globalAlpha = light.alpha;
  g.drawImage(sprite(palette), x - width * 2.2, y - width * 2.2, width * 4.4, width * 4.4);
  g.globalAlpha = 1;
}

/** A tail's light round the middle, from its end clockwise: fading in along it, then none, so its end never takes the
 * head's light. */
function fade(g: CanvasRenderingContext2D, from: number, light: { tail: number; alpha: number }, palette: OrbPalette): CanvasGradient {
  const made = g.createConicGradient(radians(from - 90), 0, 0);
  for (const along of FADE) made.addColorStop((along * light.tail) / 360, rgba(palette.light, light.alpha * along ** 1.6));
  made.addColorStop(Math.min(1, (light.tail + 2) / 360), rgba(palette.light, light.alpha));
  made.addColorStop(1, rgba(palette.light, 0));
  return made;
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

/** A sphere's glyphs as a frame shows them, back to front, each in its colour's shade for how near it is (data in its
 * second colour, as it reads). */
function glyphs(g: CanvasRenderingContext2D, shown: readonly ShownGlyph[], shades: { tint: readonly string[]; second: readonly string[] }): void {
  for (const glyph of shown) {
    if (glyph.alpha < 0.02) continue;
    g.globalAlpha = Math.min(1, glyph.alpha);
    const color = glyph.data ? shades.second[Math.max(3, glyph.shade)]! : (glyph.second ? shades.second : shades.tint)[glyph.shade]!;
    drawGlyph(g, glyph.char, color, glyph.data, glyph.x, glyph.y, glyph.size);
  }
  g.globalAlpha = 1;
}

/** One glyph `size` high, centred on (x, y), in `color`: drawn once into a sprite of its own and stamped from it after,
 * as Phren draws its field from an atlas. */
const GLYPH_PX = 48;
const glyphSprites = new Map<string, HTMLCanvasElement | null>();
function drawGlyph(g: CanvasRenderingContext2D, char: string, color: string, bold: boolean, x: number, y: number, size: number): void {
  const key = `${char}${color}${bold ? "!" : ""}`;
  let sprite = glyphSprites.get(key);
  if (sprite === undefined) {
    sprite = null;
    if (typeof document !== "undefined") {
      const made = document.createElement("canvas");
      const c = typeof made.getContext === "function" ? made.getContext("2d") : null;
      if (c) {
        made.width = made.height = GLYPH_PX;
        c.font = `${bold ? 600 : 500} ${GLYPH_PX * 0.78}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = color;
        c.fillText(char, GLYPH_PX / 2, GLYPH_PX * 0.52);
        sprite = made;
      }
    }
    glyphSprites.set(key, sprite);
  }
  if (sprite) g.drawImage(sprite, x - size * 0.64, y - size * 0.64, size * 1.28, size * 1.28);
}

/** The same glyphs, still, as SVG text. */
function stillGlyphs(shown: readonly ShownGlyph[], shades: { tint: readonly string[]; second: readonly string[] }): SVGElement[] {
  const n = (value: number) => String(Math.round(value * 100) / 100);
  return shown
    .filter((glyph) => glyph.alpha >= 0.02)
    .map((glyph) =>
      svg(
        "text",
        { x: n(glyph.x), y: n(glyph.y), "font-size": n(glyph.size), "text-anchor": "middle", "dominant-baseline": "central", "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace", "font-weight": glyph.data ? "600" : "500", fill: glyph.data ? shades.second[Math.max(3, glyph.shade)]! : (glyph.second ? shades.second : shades.tint)[glyph.shade]!, opacity: n(Math.min(1, glyph.alpha)) },
        glyph.char,
      ),
    );
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
    case "glyphs": {
      const seed = orbSeed("galahad");
      const placed = Array.from({ length: part.count }, (_, k) => ({ k, lit: dataGlyph(seed, k, 0, part.share) })).filter((each) => each.lit);
      return svg("g", named, ...placed.map(({ k, lit }) => {
        const angle = (360 * k) / part.count;
        const [x, y] = point(part.r, angle).split(" ");
        return svg("text", { x, y, "font-size": String(part.size), "text-anchor": "middle", "dominant-baseline": "central", "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace", "font-weight": "600", fill: ink(part.ink), opacity: String(Math.round(lit!.alpha * 100) / 100), transform: `rotate(${Math.round(angle * 100) / 100} ${x} ${y})` }, lit!.char);
      }));
    }
    case "sphere": {
      const sphere = orbSphere("galahad");
      const shades = { tint: sphereShades(palette.tint, palette.light, palette.deep), second: sphereShades(ink(part.second), ink(part.second), palette.light) };
      return svg("g", named, ...stillGlyphs(sphereFrame(sphere, spherePoints(sphere, part.count), { angle: 0, radius: part.r, scale: 1, glyph: part.glyph, t: 0, mood: "idle" }), shades));
    }
  }
}

/** The point `r` from the middle at `angle` degrees clockwise from the top, as SVG takes it ("x y", y down). */
function point(r: number, angle: number): string {
  const radians = (angle * Math.PI) / 180;
  const round = (n: number) => String(Math.round(n * 1000) / 1000);
  return `${round(r * Math.sin(radians))} ${round(-r * Math.cos(radians))}`;
}
