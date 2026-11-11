/*
 * Lightning: when a storm is up, a strike every few seconds, each a flash that
 * dies away in a fraction of a second, sometimes with one weaker stroke after
 * it. Where it strikes (a bearing) and whether a bolt shows (most strikes only
 * light the cloud from inside) are drawn from a seeded source, so the same
 * steps give the same storm. Gentle on purpose: at most two pulses a strike and
 * strikes seconds apart, far under three flashes a second; and under reduced
 * motion there is no lightning at all (the clock doesn't even run). Pure, so
 * unit-tested.
 */

/** No strike follows another sooner than this (seconds). */
export const MIN_GAP_S = 3.2;
/** A stroke dies away by e in this long (seconds). */
const DECAY_S = 0.085;
/** Below this the storm is too weak for lightning. */
const THRESHOLD = 0.35;

export class Lightning {
  /** How bright the flash is now, 0..1. */
  flash = 0;
  /** Where the latest strike is: a compass bearing, radians. */
  bearing = 0;
  /** Counts the strikes (a new number picks a new bolt). */
  strike = 0;
  /** Whether the latest strike shows a bolt (otherwise it only lights the cloud). */
  bolt = false;
  /** Seconds until the next strike. */
  private wait: number;
  /** Seconds since the latest strike began. */
  private age = Number.POSITIVE_INFINITY;
  /** The second stroke: when it comes after the first (seconds; 0: none) and how strong. */
  private again = 0;
  private againStrength = 0;
  private strength = 1;
  private s: number;

  constructor(seed = 20261111) {
    this.s = seed >>> 0 || 1;
    this.wait = 1.5 + this.random() * 3;
  }

  private random(): number {
    let s = this.s;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.s = s >>> 0;
    return this.s / 4294967296;
  }

  /**
   * Moves on by `dt` seconds under a storm of `storm` (0..1); returns the flash,
   * 0..1. `towards` biases where strikes fall (a compass bearing, radians: the
   * way the viewer looks), so most are seen. With `motion` false nothing
   * flashes and no time passes.
   */
  step(dt: number, storm: number, motion: boolean, towards = 0): number {
    if (!motion || (storm < THRESHOLD && this.flash === 0)) {
      this.flash = 0;
      this.age = Number.POSITIVE_INFINITY;
      return 0;
    }
    this.age += dt;
    if (storm >= THRESHOLD) {
      this.wait -= dt;
      if (this.wait <= 0) {
        // A stronger storm strikes more often: every 4–9 s at full strength, up to 14 s when it's weak.
        this.wait = MIN_GAP_S + 0.8 + this.random() * (5 + 5 * (1 - storm));
        this.age = 0;
        this.strike++;
        this.strength = 0.7 + 0.3 * this.random();
        const second = this.random() < 0.55;
        this.again = second ? 0.11 + this.random() * 0.1 : 0;
        this.againStrength = 0.45 + 0.3 * this.random();
        // Mostly ahead of the viewer (within about 70° either side), sometimes anywhere.
        const spread = this.random() < 0.8 ? (this.random() - 0.5) * 2.4 : (this.random() - 0.5) * 2 * Math.PI;
        this.bearing = towards + spread;
        this.bolt = this.random() < 0.6;
      }
    }
    let f = this.age < 2 ? this.strength * Math.exp(-this.age / DECAY_S) : 0;
    if (this.again > 0 && this.age >= this.again) f = Math.max(f, this.strength * this.againStrength * Math.exp(-(this.age - this.again) / DECAY_S));
    this.flash = f < 0.004 ? 0 : Math.min(1, f);
    return this.flash;
  }
}
