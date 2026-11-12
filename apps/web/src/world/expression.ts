/*
 * How they are, shown: his visor (the glowing line and his two eyes) and the dog's
 * tail, ears and eye. One pure function from what's so (`express`) to what shows;
 * the knight and the dog ease to it (knight.ts, care.ts and dog.ts), so nothing
 * snaps. No three.js, nothing allocated: it writes into what it's handed.
 *
 *   his eyes    open as ever; narrower when he concentrates (at a bench, writing),
 *               wider at a surprise (the dog brings the ball back, an animal
 *               bolts, a strike), softer and dimmer when he's tired in the
 *               evening, shut asleep, brighter when he's pleased (a quest ends
 *               well, he pats the dog). He blinks at an irregular pace.
 *   his head    a tilt while he listens; a nod (the caller says when: `nod`).
 *   the dog     joy (tail up and going, ears pricked), alert (tail still, ears
 *               up and turned to what it heard), tired (tail low, ears drooped,
 *               its eye dim), asleep; a play bow before a throw.
 *
 * Under reduced motion nothing blinks, nods or tilts: only what's needed to read
 * how he is (asleep: shut; otherwise as ever) is shown.
 */

/** What's so for him, this frame. */
export interface KnightFeeling {
  /** The world's clock, seconds (his blinks are a function of it). */
  t: number;
  motion: boolean;
  /** How asleep he is, 0..1 (eased by the knight: his eyes shut as it rises). */
  asleep: number;
  /** His hands and mind on a task: the blade's tip at a bench, a pen, chalk. */
  concentrating: boolean;
  thinking: boolean;
  /** Listening: someone speaks to him (Reachy at the table; you, when he greets you). */
  listening: boolean;
  /** 0..1: how tired he is (`tiredness`: the evening). */
  tired: number;
  /** 0..1, fading: something startled him; something pleased him. */
  surprise: number;
  pleased: number;
}

/** What shows of it: how far his eyes are open (1 as ever; 0 shut; over 1 wide), how bright his visor glows, how thick its line is, his head's tilt (radians), and the blink (0 open to 1 shut, on top of `open`, never eased). */
export interface KnightFace {
  open: number;
  bright: number;
  line: number;
  tilt: number;
  blink: number;
}

/** What's so for the dog. */
export interface DogFeeling {
  asleep: boolean;
  /** Its battery's low. */
  low: boolean;
  /** At play, greeted or being patted. */
  playing: boolean;
  /** Keen: after a ball, bounding to him. */
  keen: boolean;
  /** 0..1: it heard or saw something (a chase, a noise). */
  alert: number;
  /** A play bow: forelegs down, tail up (before he throws). */
  bow: boolean;
  /** Where what it heard is, as a turn from the way it faces (radians, left positive); NaN: nothing. */
  noise: number;
}

/** Its tail's wag (0 still and low to 1 up and going), its ears (0 drooped to 1 pricked), the light in its eye, the bow, and how far its ears turn (radians). */
export interface DogFace {
  wag: number;
  ears: number;
  eye: number;
  bow: number;
  earTurn: number;
}

export interface Feeling {
  knight: KnightFeeling;
  dog: DogFeeling;
}

export interface Expression {
  knight: KnightFace;
  dog: DogFace;
}

export const neutralFace = (): Expression => ({ knight: { open: 1, bright: 1, line: 1, tilt: 0, blink: 0 }, dog: { wag: 0.5, ears: 0.6, eye: 1, bow: 0, earTurn: 0 } });

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const smooth = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
/** A number in [0, 1) from a whole number: the same every time. */
const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A blink takes this long (seconds): shutting fast, opening a little slower. */
const BLINK = 0.17;
/** One blink is due in each stretch of this long, somewhere in it: so the gaps run from a fraction of a second to nearly twice it. */
const BLINK_EVERY = 4.3;

/** One blink's lid, `u` seconds after it began (0 open to 1 shut). */
const lid = (u: number): number => (u < 0 || u > BLINK ? 0 : u < 0.06 ? u / 0.06 : u < 0.09 ? 1 : 1 - (u - 0.09) / (BLINK - 0.09));

/**
 * How far his eyes are shut by a blink at time `t` (seconds): 0 nearly always. Irregular, as a blink is: one in
 * each stretch of a few seconds, when in it decided by the stretch's number; about one in five is doubled.
 * A function of the time alone, so it needs no state and every device blinks the same.
 */
export function blink(t: number): number {
  if (!(t >= 0)) return 0;
  const k = Math.floor(t / BLINK_EVERY);
  let shut = 0;
  // This stretch's blink, and the last one's (a blink late in a stretch may end in the next).
  for (let j = k - 1; j <= k; j++) {
    if (j < 0) continue;
    const at = j * BLINK_EVERY + hash(j) * (BLINK_EVERY - 0.2);
    shut = Math.max(shut, lid(t - at));
    if (hash(j + 0.5) < 0.2) shut = Math.max(shut, lid(t - at - 0.3));
  }
  return shut;
}

/** How tired he is by the hour in Denmark (0..24): not at all by day, more from half past seven, quite by ten; a little, just woken. */
export function tiredness(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return 1;
  if (h < 8) return 0.45 * (1 - smooth(6, 8, h));
  return smooth(19.5, 22, h);
}

/** A nod, `u` seconds after it began: down and back, and a smaller one after (radians of pitch; 0 outside it). */
export function nod(u: number): number {
  if (u < 0 || u > 1.1) return 0;
  return u < 0.55 ? 0.2 * Math.sin((u / 0.55) * Math.PI) : 0.08 * Math.sin(((u - 0.55) / 0.55) * Math.PI);
}

/** His face for how he is. */
export function knightFace(s: KnightFeeling, out: KnightFace): KnightFace {
  if (!s.motion) {
    // Reduced motion: only what's needed to read his state.
    out.open = s.asleep > 0.5 ? 0.05 : 1;
    out.bright = 1;
    out.line = 1;
    out.tilt = 0;
    out.blink = 0;
    return out;
  }
  let open = s.concentrating ? 0.6 : s.thinking ? 0.82 : 1;
  let bright = s.concentrating ? 1.08 : 1;
  let line = s.concentrating ? 0.6 : 1;
  // Tired: softer and dimmer, his eyes a little lower.
  open *= 1 - 0.28 * s.tired;
  bright *= 1 - 0.4 * s.tired;
  // Pleased: a brightening. Surprised: wide, at once.
  const pleased = clamp(s.pleased, 0, 1);
  const surprise = clamp(s.surprise, 0, 1);
  bright += 0.6 * pleased + 0.3 * surprise;
  open += (1.45 - open) * surprise + 0.1 * pleased * (1 - surprise);
  line += (1.9 - line) * surprise;
  // Asleep: shut (the knight dims his visor itself).
  const asleep = clamp(s.asleep, 0, 1);
  open += (0.05 - open) * asleep;
  line += (0.7 - line) * asleep;
  out.open = open;
  out.bright = bright;
  out.line = line;
  out.tilt = s.listening && asleep < 0.5 ? 0.16 + 0.03 * Math.sin(s.t * 0.9) : 0;
  out.blink = asleep > 0.3 ? 0 : blink(s.t);
  return out;
}

/** The dog's tail, ears and eye for how it is. */
export function dogFace(s: DogFeeling, out: DogFace): DogFace {
  const alert = clamp(s.alert, 0, 1);
  if (s.asleep) {
    out.wag = 0;
    out.ears = 0.2;
    out.eye = 0.07;
    out.bow = 0;
    out.earTurn = 0;
    return out;
  }
  // Tired: tail low and slow, ears drooped, its eye dim. Otherwise at play its tail's up and going; alert, it's still.
  out.wag = s.low ? 0.12 : s.bow ? 1 : s.playing ? 1 : 0.5 - 0.3 * alert;
  out.ears = s.low ? 0.1 : s.keen || s.bow ? 1 : 0.6 + 0.4 * alert;
  out.eye = s.low ? 0.35 : 1;
  out.bow = s.bow && !s.low ? 1 : 0;
  // Its ears turn to what it heard, as far as ears do.
  out.earTurn = s.low || Number.isNaN(s.noise) ? 0 : clamp(s.noise, -0.9, 0.9) * alert;
  return out;
}

/** How they are, shown: the one function from state to expression. */
export function express(s: Feeling, out: Expression): Expression {
  knightFace(s.knight, out.knight);
  dogFace(s.dog, out.dog);
  return out;
}
