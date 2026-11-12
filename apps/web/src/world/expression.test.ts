import { describe, expect, test } from "bun:test";
import { Knight, type KnightState } from "./knight.ts";
import { blink, type DogFeeling, dogFace, express, type KnightFeeling, knightFace, neutralFace, nod, tiredness } from "./expression.ts";

/*
 * How they are, shown: one pure function from what's so to his visor and the dog's
 * tail, ears and eye. Held here: each state reads as itself and differs from the
 * others, a blink is brief and irregular, reduced motion shows only what's needed.
 */

const him = (over: Partial<KnightFeeling> = {}): KnightFeeling => ({ t: 1.0, motion: true, asleep: 0, concentrating: false, thinking: false, listening: false, tired: 0, surprise: 0, pleased: 0, ...over });
const it = (over: Partial<DogFeeling> = {}): DogFeeling => ({ asleep: false, low: false, playing: false, keen: false, alert: 0, bow: false, noise: Number.NaN, ...over });
const face = (over: Partial<KnightFeeling> = {}) => ({ ...knightFace(him(over), neutralFace().knight) });
const dog = (over: Partial<DogFeeling> = {}) => ({ ...dogFace(it(over), neutralFace().dog) });

/** A moment with no blink in it (blinks are a function of the time). */
const calm = (() => {
  for (let t = 1; t < 20; t += 0.05) if (blink(t) === 0 && blink(t - 0.2) === 0 && blink(t + 0.2) === 0) return t;
  throw new Error("no calm moment");
})();

describe("his visor", () => {
  test("as ever: open, as bright as ever, level", () => {
    expect(face({ t: calm })).toEqual({ open: 1, bright: 1, line: 1, tilt: 0, blink: 0 });
  });

  test("narrower when he concentrates; wider at a surprise than he ever is otherwise; shut asleep", () => {
    const working = face({ t: calm, concentrating: true });
    expect(working.open).toBeLessThan(0.7);
    expect(working.line).toBeLessThan(0.7);
    expect(face({ t: calm, thinking: true }).open).toBeLessThan(1);
    expect(face({ t: calm, thinking: true }).open).toBeGreaterThan(working.open);
    const startled = face({ t: calm, surprise: 1, concentrating: true });
    expect(startled.open).toBeGreaterThan(1.3);
    expect(startled.line).toBeGreaterThan(1.5);
    // It passes: halfway faded, he's halfway back to his work.
    expect(face({ t: calm, surprise: 0.5, concentrating: true }).open).toBeLessThan(startled.open);
    const asleep = face({ t: calm, asleep: 1, surprise: 0, pleased: 0 });
    expect(asleep.open).toBeLessThan(0.1);
    expect(asleep.blink).toBe(0);
  });

  test("softer and dimmer when he's tired; brighter when he's pleased", () => {
    const tired = face({ t: calm, tired: 1 });
    expect(tired.bright).toBeLessThan(0.7);
    expect(tired.open).toBeLessThan(0.8);
    expect(tired.open).toBeGreaterThan(0.5);
    const pleased = face({ t: calm, pleased: 1 });
    expect(pleased.bright).toBeGreaterThan(1.4);
    expect(face({ t: calm, pleased: 1, tired: 1 }).bright).toBeGreaterThan(tired.bright);
    // Out-of-range feelings don't run away.
    expect(face({ t: calm, pleased: 9, surprise: 9 }).bright).toBeLessThan(2.2);
  });

  test("a tilt while he listens (not asleep); a nod is down and back within a second or so", () => {
    expect(face({ t: calm, listening: true }).tilt).toBeGreaterThan(0.1);
    expect(face({ t: calm, listening: true, asleep: 1 }).tilt).toBe(0);
    expect(nod(-0.1)).toBe(0);
    expect(nod(0.27)).toBeGreaterThan(0.15);
    expect(nod(0.8)).toBeGreaterThan(0);
    expect(nod(0.8)).toBeLessThan(nod(0.27));
    expect(nod(1.2)).toBe(0);
  });

  test("he blinks: briefly, at an irregular pace, the same on every device", () => {
    const starts: number[] = [];
    let shutFor = 0;
    let was = 0;
    const dt = 1 / 120;
    for (let t = 0; t < 600; t += dt) {
      const b = blink(t);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      if (b > 0.5) shutFor += dt;
      if (b > 0 && was === 0) starts.push(t);
      was = b;
    }
    // Between ten and thirty a minute, as eyes do; shut a couple of percent of the time at most.
    const perMinute = starts.length / 10;
    expect(perMinute).toBeGreaterThan(10);
    expect(perMinute).toBeLessThan(30);
    expect(shutFor / 600).toBeLessThan(0.03);
    // Irregular: the gaps between blinks vary by seconds.
    const gaps = starts.slice(1).map((s, i) => s - starts[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(3);
    expect(Math.max(...gaps)).toBeLessThan(9);
    expect(blink(123.456)).toBe(blink(123.456));
    expect(blink(Number.NaN)).toBe(0);
    // A blink shows in his face, on top of how open his eyes are.
    const mid = starts[5]! + 0.07;
    expect(face({ t: mid }).blink).toBeGreaterThan(0.9);
  });

  test("tired by the hour in Denmark: not by day, more through the evening, a little just woken", () => {
    expect(tiredness(12)).toBe(0);
    expect(tiredness(19)).toBe(0);
    expect(tiredness(21)).toBeGreaterThan(0.3);
    expect(tiredness(21)).toBeLessThan(tiredness(21.9));
    expect(tiredness(23)).toBe(1);
    expect(tiredness(2)).toBe(1);
    expect(tiredness(6.3)).toBeGreaterThan(0.2);
    expect(tiredness(9)).toBe(0);
    expect(tiredness(36)).toBe(tiredness(12));
  });

  test("under reduced motion: only what's needed to read his state (shut asleep, otherwise as ever); nothing blinks or tilts", () => {
    const still = (over: Partial<KnightFeeling>) => face({ motion: false, ...over });
    expect(still({ concentrating: true, surprise: 1, pleased: 1, tired: 1, listening: true })).toEqual({ open: 1, bright: 1, line: 1, tilt: 0, blink: 0 });
    expect(still({ asleep: 1 }).open).toBeLessThan(0.1);
    for (let t = 0; t < 30; t += 0.03) expect(still({ t }).blink).toBe(0);
  });
});

describe("the dog", () => {
  test("joy, alert, tired and asleep each read as themselves", () => {
    const rest = dog();
    expect(rest).toEqual({ wag: 0.5, ears: 0.6, eye: 1, bow: 0, earTurn: 0 });
    const joy = dog({ playing: true, keen: true });
    expect(joy.wag).toBe(1);
    expect(joy.ears).toBe(1);
    // Alert: its tail still, its ears up.
    const alert = dog({ alert: 1 });
    expect(alert.wag).toBeLessThan(rest.wag);
    expect(alert.ears).toBe(1);
    // Tired: tail low, ears drooped, its eye dim; whatever else is going on.
    const tired = dog({ low: true, playing: true, keen: true, alert: 1, bow: true, noise: 1 });
    expect(tired).toEqual({ wag: 0.12, ears: 0.1, eye: 0.35, bow: 0, earTurn: 0 });
    expect(dog({ asleep: true, playing: true, alert: 1, noise: 1 })).toEqual({ wag: 0, ears: 0.2, eye: 0.07, bow: 0, earTurn: 0 });
  });

  test("its ears turn to what it heard, as far as ears do, and only while it minds it", () => {
    expect(dog({ alert: 1, noise: 0.5 }).earTurn).toBeCloseTo(0.5);
    expect(dog({ alert: 1, noise: -2.5 }).earTurn).toBeCloseTo(-0.9);
    expect(dog({ alert: 0.5, noise: 0.5 }).earTurn).toBeCloseTo(0.25);
    expect(dog({ alert: 0, noise: 0.5 }).earTurn).toBe(0);
    expect(dog({ alert: 1 }).earTurn).toBe(0);
  });

  test("a play bow before a throw: down in front, tail up and going, ears pricked", () => {
    expect(dog({ bow: true })).toMatchObject({ bow: 1, wag: 1, ears: 1 });
  });
});

describe("one function for both", () => {
  test("express writes his face and the dog's into what it's handed, and nothing else", () => {
    const out = neutralFace();
    const knight = out.knight;
    const same = express({ knight: him({ t: calm, concentrating: true }), dog: it({ playing: true }) }, out);
    expect(same).toBe(out);
    expect(out.knight).toBe(knight);
    expect(out.knight.open).toBeLessThan(0.7);
    expect(out.dog.wag).toBe(1);
  });
});

describe("on the knight himself", () => {
  const still: KnightState = { moving: false, running: false, working: false, thinking: false, armed: false, bench: false };
  const nothing = { x: 0, y: 0, z: 0, on: false };
  const flat = () => 0;
  const visor = { open: 0, line: 0, bright: 0 };
  /** A few seconds of him standing there with that face. */
  const wear = (knight: Knight, state: KnightState, seconds = 3, motion = true) => {
    for (let t = 0; t < seconds; t += 1 / 30) knight.animate(1 / 30, t, state, 0, 0, 0, 0, flat, nothing, motion);
    return { ...knight.visorNow(visor) };
  };

  test("his eyes narrow, widen and shut by what his face says, eased; a blink shuts them at once; his visor's lights follow", () => {
    const knight = new Knight(false);
    expect(wear(knight, still)).toMatchObject({ open: 1, line: 1, bright: 1 });
    const narrowed = wear(knight, { ...still, face: { open: 0.6, bright: 1.08, line: 0.6, tilt: 0, blink: 0 } });
    expect(narrowed.open).toBeCloseTo(0.6, 2);
    expect(narrowed.line).toBeCloseTo(0.6, 2);
    expect(narrowed.bright).toBeCloseTo(1.08, 2);
    // Eased: a frame after a surprise they're on their way, not there.
    const one = wear(knight, { ...still, face: { open: 1.45, bright: 1.3, line: 1.9, tilt: 0, blink: 0 } }, 1 / 30);
    expect(one.open).toBeGreaterThan(0.6);
    expect(one.open).toBeLessThan(1.2);
    // A blink is at once, on top of how open they are.
    const blinked = wear(knight, { ...still, face: { open: 1, bright: 1, line: 1, tilt: 0, blink: 1 } }, 2);
    expect(blinked.open).toBeLessThan(0.08);
    expect(wear(knight, { ...still, face: { open: 1, bright: 1, line: 1, tilt: 0, blink: 0 } }, 1 / 30).open).toBeGreaterThan(0.2);
    knight.dispose();
  });

  test("asleep with no face given, his eyes shut as he falls asleep (as his visor dims); under reduced motion they're simply shut", () => {
    const knight = new Knight(false);
    const asleep: KnightState = { ...still, care: { crouch: 0, reach: 0, throw: 0, tilt: 0, sit: 0, lie: 1, asleep: 1 } };
    const falling = wear(knight, asleep, 0.5);
    expect(falling.open).toBeLessThan(1);
    expect(falling.open).toBeGreaterThan(0.2);
    expect(wear(knight, asleep, 8).open).toBeLessThan(0.1);
    const other = new Knight(false);
    expect(wear(other, asleep, 1 / 30, false).open).toBeLessThan(0.1);
    knight.dispose();
    other.dispose();
  });

  test("a nod tips his head, a tilt leans it, and his eyes go with it", () => {
    const knight = new Knight(false);
    wear(knight, still, 1);
    const level = knight.head.quaternion.clone();
    wear(knight, { ...still, nod: 0.2 }, 1 / 30);
    const nodded = knight.head.quaternion.angleTo(level);
    expect(nodded).toBeGreaterThan(0.15);
    wear(knight, { ...still, face: { open: 1, bright: 1, line: 1, tilt: 0.16, blink: 0 } }, 3);
    expect(knight.head.quaternion.angleTo(level)).toBeGreaterThan(0.1);
    knight.dispose();
  });
});
