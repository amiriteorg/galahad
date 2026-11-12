/*
 * What can be heard in his world, and how loud: the pure half of the sound
 * (sound.ts is the thin Web Audio layer over it). Everything is synthesised from
 * noise and oscillators: there are no recordings.
 *
 *   the world    wind by the real wind's strength, rain by its weight, thunder
 *                after a strike (by how far off it was), the lake lapping near
 *                its shore, the fire's hiss and crackle while it burns, birds
 *                by season and hour (a dawn chorus in spring, little in
 *                November, none at night but the owl), ducks, geese crossing,
 *                insects on a summer's day. Only what the weather, the sky and
 *                the ecosystem say is there.
 *   him, the dog his footsteps by what he walks on, the pen on his journal and
 *                the chalk on a slate, his blade's tip at the forge, his sword
 *                set on its stand; the dog's steps, its bark, a pat, the ball.
 *   signals      a quiet chime when a quest ends reviewed, another when
 *                something needs you.
 *
 * `mixFor` says how loud each continuous thing is and how often each call
 * comes; `hear` places a sound relative to the listener (nearer is louder, left
 * is left); `RECIPES` says how each short sound is made. No Web Audio in here:
 * all of it is unit-tested, and it writes into what it's handed.
 */

const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x));
const DEG = Math.PI / 180;

// ---------- what he walks on ----------

export type Surface = "grass" | "path" | "stone" | "wood" | "snow";

/** What's underfoot: planks (the deck, the stairs, a bridge), a floor or paving, lying snow, a beaten path, else grass. */
export function surfaceFor(s: { raised: boolean; indoors: boolean; paved: boolean; built: boolean; snow: number }): Surface {
  if (s.raised && !s.indoors) return "wood";
  if (s.indoors || s.paved) return "stone";
  if (s.snow > 0.35) return "snow";
  return s.built ? "path" : "grass";
}

// ---------- the mix ----------

/** The world as the sound needs it (the scene fills one in, a few times a second). */
export interface SoundWorld {
  wind: number;
  rain: number;
  snow: number;
  storm: number;
  /** The listener: where (world metres), the way it looks (atan2 convention), how far it's under the hall's roof (0..1). */
  x: number;
  y: number;
  yaw: number;
  indoors: number;
  /** The nearest water's edge to the listener: how far (metres; Infinity: none near) and where. */
  shore: number;
  shoreX: number;
  shoreY: number;
  /** His fire: burning, and where. */
  fire: boolean;
  fireX: number;
  fireY: number;
  /** A pen on paper or chalk on slate, now, and where. */
  writing: boolean;
  writeX: number;
  writeY: number;
  /** The sun's height (radians) and whether it's past noon (over a half: sinking). */
  sunElevation: number;
  evening: number;
  /** The season's weights (they sum to 1). */
  spring: number;
  summer: number;
  autumn: number;
  winter: number;
  /** Who's about (the ecosystem's own count): songbirds awake, owls, ducks, geese crossing, and what flies from flower to flower. */
  songbirds: number;
  owls: number;
  ducks: number;
  geese: number;
  insects: number;
}

/** How loud each continuous sound is (0..1) and where, and how often each call comes (a second). */
export interface Mix {
  wind: number;
  /** The wind's pitch (Hz): it whistles higher as it rises. */
  windTone: number;
  rain: number;
  /** The rain's brightness (Hz): a patter when it's light, a roar when it's heavy, a drumming under a roof. */
  rainTone: number;
  lake: number;
  lakePan: number;
  fire: number;
  firePan: number;
  /** The fire's crackles, a second. */
  crackle: number;
  scratch: number;
  scratchPan: number;
  insects: number;
  /** Songbirds' calls a second, and how rich they are (0 a chirp to 1 a dawn chorus). */
  song: number;
  chorus: number;
  owl: number;
  quack: number;
  honk: number;
}

export const emptyMix = (): Mix => ({ wind: 0, windTone: 300, rain: 0, rainTone: 4000, lake: 0, lakePan: 0, fire: 0, firePan: 0, crackle: 0, scratch: 0, scratchPan: 0, insects: 0, song: 0, chorus: 0, owl: 0, quack: 0, honk: 0 });

export const emptySoundWorld = (): SoundWorld => ({ wind: 0, rain: 0, snow: 0, storm: 0, x: 0, y: 0, yaw: 0, indoors: 0, shore: Number.POSITIVE_INFINITY, shoreX: 0, shoreY: 0, fire: false, fireX: 0, fireY: 0, writing: false, writeX: 0, writeY: 0, sunElevation: 0.5, evening: 0, spring: 0, summer: 1, autumn: 0, winter: 0, songbirds: 0, owls: 0, ducks: 0, geese: 0, insects: 0 });

const placed = { gain: 0, pan: 0 };

/**
 * A sound at (sx, sy) as the listener at (x, y), looking along `yaw`, hears it: as loud as it is within `near` metres,
 * fading to nothing at `far`; to the left when it's on the left (pan −1) and the right when it's on the right (+1),
 * in the middle when it's at the listener's own feet. Into `out`.
 */
export function hear(x: number, y: number, yaw: number, sx: number, sy: number, near: number, far: number, out: { gain: number; pan: number }): { gain: number; pan: number } {
  const dx = sx - x;
  const dy = sy - y;
  const d = Math.hypot(dx, dy);
  const k = clamp(1 - (d - near) / Math.max(1e-6, far - near));
  out.gain = k * k;
  // The source's bearing from the way the listener looks: positive is to its left.
  out.pan = d < 1e-6 ? 0 : -Math.sin(Math.atan2(dy, dx) - yaw) * Math.min(1, d / 3);
  return out;
}

/** How much the birds sing by the sun: nothing at night, most at dawn, a little through the day, more again towards dusk. */
export function songByHour(sunElevation: number, evening: number): number {
  const deg = sunElevation / DEG;
  if (deg < -5) return 0;
  const low = clamp(1 - (deg - 2) / 14);
  // Rising (morning): the dawn chorus. Sinking: an evening's singing, less of it.
  const peak = evening < 0.5 ? 1 : 0.55;
  return clamp((deg + 5) / 4) * (0.3 + (peak - 0.3) * low);
}

/** How much they sing by the season: spring most, summer less, autumn little, winter least. */
export const songBySeason = (w: { spring: number; summer: number; autumn: number; winter: number }): number => w.spring * 1 + w.summer * 0.6 + w.autumn * 0.22 + w.winter * 0.1;

/** What's heard now, and how loud: into `out`. */
export function mixFor(w: SoundWorld, out: Mix): Mix {
  const outdoors = 1 - clamp(w.indoors);
  // Falling snow hushes everything a little.
  const hush = 1 - 0.2 * clamp(w.snow);
  // Wind: a light breeze is a murmur, a gale fills the ear; under a roof it's the walls that take it.
  out.wind = clamp((w.wind - 0.6) / 15) ** 0.8 * (0.35 + 0.65 * outdoors);
  out.windTone = 240 + 42 * Math.min(22, w.wind);
  // Rain: on leaves and grass outdoors; on the roof indoors (duller, and nearly as loud).
  out.rain = clamp(w.rain) ** 0.7 * (0.7 + 0.3 * outdoors);
  out.rainTone = w.indoors > 0.5 ? 900 : 5200 - 2600 * clamp(w.rain);
  // The lake: lapping at its edge, louder in a wind, within thirty metres.
  hear(w.x, w.y, w.yaw, w.shoreX, w.shoreY, 3, 30, placed);
  out.lake = Number.isFinite(w.shore) ? placed.gain * (0.4 + 0.6 * clamp(w.wind / 9)) * outdoors * hush : 0;
  out.lakePan = placed.pan;
  // The fire: a hiss and its crackles, within twenty metres.
  hear(w.x, w.y, w.yaw, w.fireX, w.fireY, 1.5, 20, placed);
  out.fire = w.fire ? placed.gain * outdoors : 0;
  out.firePan = placed.pan;
  out.crackle = 3.2 * out.fire;
  // A pen or chalk: heard from close by.
  hear(w.x, w.y, w.yaw, w.writeX, w.writeY, 1.5, 12, placed);
  out.scratch = w.writing ? placed.gain : 0;
  out.scratchPan = placed.pan;
  // The birds: who's about, by the hour and the season; none in a downpour or a storm, fewer in a wind.
  const dry = clamp(1 - w.rain * 2.5) * clamp(1 - w.storm * 1.5) * (1 - 0.5 * clamp(w.wind / 16));
  const hour = songByHour(w.sunElevation, w.evening);
  const season = songBySeason(w);
  out.song = 1.5 * clamp(w.songbirds / 24) * hour * season * dry * outdoors * hush;
  out.chorus = clamp(w.spring * 1.3 + w.summer * 0.4) * (w.evening < 0.5 ? clamp(1 - (w.sunElevation / DEG - 2) / 14) : 0);
  // The owl: at night, when one's about, in the dry.
  out.owl = w.owls > 0 && w.sunElevation < -6 * DEG ? 0.035 * clamp(1 - w.rain * 3) * outdoors : 0;
  // Ducks: by day and dusk, heard near the water. Geese: while a skein crosses.
  out.quack = w.sunElevation > -6 * DEG ? 0.09 * clamp(w.ducks / 6) * clamp(1 - (w.shore - 10) / 60) * dry * outdoors : 0;
  out.honk = 0.3 * clamp(w.geese / 6) * outdoors;
  // Insects: a summer's day, in the dry, where the flowers are.
  out.insects = w.sunElevation > 4 * DEG ? clamp(w.insects / 50) * clamp(w.summer + 0.5 * w.spring) * clamp(1 - w.rain * 4) * outdoors * 0.6 : 0;
  return out;
}

/** Thunder after a strike: how long after the flash it's heard (seconds), how loud, and how long it rolls. A strike that showed its bolt was nearer. */
export function thunderFor(strike: number, bolt: boolean): { delay: number; gain: number; seconds: number } {
  // How far off (metres), from the strike's own number: the same strike is the same distance on every device.
  const r = Math.abs(Math.sin(strike * 12.9898) * 43758.5453) % 1;
  const metres = bolt ? 500 + 1600 * r : 1500 + 3500 * r;
  return { delay: metres / 343, gain: clamp(1.15 - metres / 5200), seconds: 2.2 + metres / 1300 };
}

// ---------- the short sounds: how each is made ----------

/** One note: a burst of filtered noise, or an oscillator gliding from `f0` to `f1`, with a quick attack and an exponential decay. */
export interface Note {
  /** Seconds after the sound begins. */
  at: number;
  src: "noise" | "sine" | "triangle" | "square" | "sawtooth";
  /** The oscillator's pitch at its start and end (Hz); for noise, its filter's. */
  f0: number;
  f1: number;
  /** Noise only: the filter's kind and sharpness. */
  filter?: "lowpass" | "bandpass" | "highpass";
  q?: number;
  attack: number;
  decay: number;
  gain: number;
}

export type SoundKind =
  | `step-${Surface}`
  | "paw"
  | "bark"
  | "pat"
  | "ball"
  | "hammer"
  | "clink"
  | "crackle"
  | "chirp"
  | "phrase"
  | "owl"
  | "quack"
  | "honk"
  | "thunder"
  | "chime-done"
  | "chime-needs";

const noise = (at: number, f: number, filter: Note["filter"], q: number, attack: number, decay: number, gain: number, f1 = f): Note => ({ at, src: "noise", f0: f, f1, filter, q, attack, decay, gain });
const tone = (at: number, src: Note["src"], f0: number, f1: number, attack: number, decay: number, gain: number): Note => ({ at, src, f0, f1, attack, decay, gain });

/** How each short sound is made: a few notes each, all from noise and oscillators. */
export const RECIPES: Record<SoundKind, readonly Note[]> = {
  // His steps: a soft swish in grass, a crunch on a path, a click and a thud on stone, a hollow knock on planks, a squeak in snow.
  "step-grass": [noise(0, 950, "lowpass", 0.7, 0.008, 0.09, 0.5), noise(0.02, 3200, "bandpass", 0.8, 0.01, 0.06, 0.12)],
  "step-path": [noise(0, 1900, "bandpass", 0.9, 0.004, 0.07, 0.5), noise(0.03, 2600, "bandpass", 1.4, 0.004, 0.05, 0.2)],
  "step-stone": [noise(0, 1500, "bandpass", 3, 0.002, 0.04, 0.55), tone(0, "sine", 110, 70, 0.003, 0.07, 0.4)],
  "step-wood": [tone(0, "sine", 170, 95, 0.003, 0.11, 0.7), noise(0, 800, "bandpass", 2, 0.003, 0.05, 0.3)],
  "step-snow": [noise(0, 520, "lowpass", 0.7, 0.012, 0.13, 0.5), noise(0.03, 4200, "bandpass", 2.5, 0.02, 0.08, 0.1)],
  // The dog: light quick feet; a bark in two short yaps (it's a robot: a square wave with a fall to it); a pat on its plates; its ball.
  paw: [noise(0, 2400, "bandpass", 1.2, 0.002, 0.03, 0.3)],
  bark: [tone(0, "square", 520, 330, 0.008, 0.1, 0.5), tone(0.17, "square", 560, 340, 0.008, 0.13, 0.55)],
  pat: [noise(0, 380, "lowpass", 0.8, 0.006, 0.07, 0.5), tone(0, "sine", 240, 180, 0.004, 0.05, 0.15)],
  ball: [tone(0, "sine", 230, 150, 0.003, 0.09, 0.6)],
  // His blade's tip on the work (a bright ring), and his sword set on its stand (a lower one, twice).
  hammer: [tone(0, "sine", 2350, 2300, 0.001, 0.22, 0.3), tone(0, "sine", 3720, 3650, 0.001, 0.12, 0.16), noise(0, 3000, "bandpass", 1.5, 0.001, 0.02, 0.25)],
  clink: [tone(0, "sine", 1480, 1450, 0.001, 0.35, 0.3), tone(0, "sine", 2210, 2180, 0.001, 0.2, 0.18), tone(0.09, "sine", 1320, 1300, 0.001, 0.3, 0.14)],
  crackle: [noise(0, 2600, "bandpass", 1.2, 0.001, 0.025, 0.5)],
  // Birds: a chirp; a phrase (the chorus); the tawny owl's hoot and its quaver; a duck; a goose.
  chirp: [tone(0, "sine", 3600, 2900, 0.006, 0.06, 0.3), tone(0.1, "sine", 3100, 3900, 0.006, 0.07, 0.3)],
  phrase: [tone(0, "sine", 2500, 3300, 0.01, 0.1, 0.28), tone(0.14, "sine", 3300, 2700, 0.01, 0.09, 0.28), tone(0.27, "sine", 2900, 3900, 0.01, 0.12, 0.3), tone(0.44, "sine", 3500, 3100, 0.01, 0.16, 0.24)],
  owl: [tone(0, "sine", 360, 340, 0.08, 0.5, 0.4), tone(1.6, "sine", 370, 350, 0.04, 0.12, 0.3), tone(1.85, "sine", 365, 330, 0.06, 0.7, 0.4)],
  quack: [tone(0, "sawtooth", 420, 330, 0.01, 0.1, 0.22), tone(0.19, "sawtooth", 400, 310, 0.01, 0.1, 0.2), tone(0.37, "sawtooth", 380, 300, 0.01, 0.13, 0.16)],
  honk: [tone(0, "sawtooth", 520, 430, 0.02, 0.16, 0.18), tone(0.24, "sawtooth", 470, 400, 0.02, 0.2, 0.16)],
  // Thunder: a crack, then a long low roll (the engine stretches its decay by how far off it was).
  thunder: [noise(0, 1400, "lowpass", 0.5, 0.01, 0.3, 0.5, 300), noise(0.12, 170, "lowpass", 0.6, 0.25, 1, 1, 70)],
  // Signals: two soft bells rising when a quest ends reviewed; two falling, lower, when something needs you.
  "chime-done": [tone(0, "sine", 659.3, 659.3, 0.005, 1.1, 0.22), tone(0.16, "sine", 987.8, 987.8, 0.005, 1.4, 0.2), tone(0.16, "sine", 1975.5, 1975.5, 0.005, 0.5, 0.05)],
  "chime-needs": [tone(0, "sine", 440, 440, 0.005, 1.1, 0.22), tone(0.24, "sine", 370, 370, 0.005, 1.5, 0.22)],
};

/** How long a sound lasts (seconds): its last note's end. */
export const soundSeconds = (kind: SoundKind, stretch = 1): number => Math.max(...RECIPES[kind].map((n) => n.at + n.attack + n.decay * stretch * 3));

/** A small seeded source of chance for the calls (which bird, where from): the same on every device isn't needed, steady and cheap is. */
export function chance(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
