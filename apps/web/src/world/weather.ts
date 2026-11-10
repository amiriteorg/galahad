/*
 * The SANDBOX's weather: a small state (clear, overcast, mist, drizzle, rain)
 * that the world eases towards, never jumps to. Clouds gather before the rain
 * starts and the rain stops before they clear; the ground gets wet while it
 * rains and dries slowly after; mist lies at dawn and after rain, thin by day.
 * Nothing here fetches anything: the HUD sets the kind (and later, a feed of real
 * Danish weather could, through `set`). Pure, so unit-tested.
 */

export type WeatherKind = "clear" | "overcast" | "mist" | "drizzle" | "rain";

export const WEATHER_KINDS: readonly WeatherKind[] = ["clear", "overcast", "mist", "drizzle", "rain"];

/** Where the weather stands, every value 0..1. */
export interface WeatherState {
  /** Cloud cover: a greyer, softer sky, weaker sun and shadows. */
  cloud: number;
  /** Rain: streaks, ripples, splashes. */
  rain: number;
  /** Mist: low, height-bound fog in hollows and over water (the weather's, the dawn's and the rain's). */
  mist: number;
  /** How wet the ground, rocks and roofs are: darker, with a sheen. */
  wetness: number;
}

interface Target {
  cloud: number;
  rain: number;
  mist: number;
}

const TARGETS: Record<WeatherKind, Target> = {
  clear: { cloud: 0, rain: 0, mist: 0 },
  overcast: { cloud: 0.8, rain: 0, mist: 0.1 },
  mist: { cloud: 0.35, rain: 0, mist: 0.75 },
  drizzle: { cloud: 0.72, rain: 0.35, mist: 0.3 },
  rain: { cloud: 0.92, rain: 1, mist: 0.22 },
};

/** Seconds to cover about two thirds of the way (an exponential ease). */
const CLOUD_IN = 9;
const CLOUD_OUT = 16;
const RAIN_IN = 5;
const RAIN_OUT = 3.5;
const MIST = 10;
/** Full rain soaks the ground in about this many seconds; it dries over a few minutes (faster in sunshine). */
const SOAK_S = 25;
const DRY_S = 240;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const ease = (from: number, to: number, dt: number, tau: number): number => to + (from - to) * Math.exp(-dt / tau);

/**
 * The mist the day itself brings, with clear skies: a bank at dawn (strongest
 * just after sunrise, burnt off as the sun climbs), a little in the night, and
 * none by day (so a clear day doesn't pay for mist at all). `elevationDeg` is the sun's height; `evening` is 0 in the
 * morning, 1 in the evening.
 */
export function naturalMist(elevationDeg: number, evening: number): number {
  const morning = clamp01(1 - evening * 1.4);
  const dawn = smooth(-9, 0, elevationDeg) * (1 - smooth(3, 13, elevationDeg)) * morning;
  const night = (1 - smooth(-6, 2, elevationDeg)) * 0.12;
  return Math.max(dawn * 0.52, night);
}

export class Weather {
  kind: WeatherKind;
  readonly state: WeatherState = { cloud: 0, rain: 0, mist: 0, wetness: 0 };

  constructor(kind: WeatherKind = "clear") {
    this.kind = kind;
    this.snap(0, 0.5);
  }

  /** What the weather should become (it eases there). */
  set(kind: WeatherKind): void {
    this.kind = kind;
  }

  /** Straight to the kind's look (first sight): no easing, and wet ground if it rains. */
  snap(elevationDeg: number, evening: number): WeatherState {
    const t = TARGETS[this.kind];
    this.state.cloud = t.cloud;
    this.state.rain = t.rain;
    this.state.wetness = t.rain > 0 ? Math.min(1, 0.5 + t.rain * 0.5) : 0;
    this.state.mist = this.mistTarget(t, elevationDeg, evening);
    return this.state;
  }

  /** The mist straight to what this sun and weather bring (the time of day jumped: a preset). */
  settleMist(elevationDeg: number, evening: number): void {
    this.state.mist = this.mistTarget(TARGETS[this.kind], elevationDeg, evening);
  }

  /** Moves the weather on by `dt` seconds, given the sun (degrees above the horizon, and morning 0 → evening 1). */
  step(dt: number, elevationDeg: number, evening: number): WeatherState {
    const s = this.state;
    const t = TARGETS[this.kind];
    s.cloud = ease(s.cloud, t.cloud, dt, t.cloud > s.cloud ? CLOUD_IN : CLOUD_OUT);
    // Rain only falls from a sky that has clouded over.
    const rainTarget = t.rain * smooth(0.45, 0.8, s.cloud);
    s.rain = ease(s.rain, rainTarget, dt, rainTarget > s.rain ? RAIN_IN : RAIN_OUT);
    if (s.rain < 1e-3 && rainTarget === 0) s.rain = 0;
    // Wet while it rains; dry after, faster under a bright sun than an overcast one.
    if (s.rain > 0.02) s.wetness = Math.min(1, s.wetness + (dt / SOAK_S) * (0.3 + s.rain));
    else {
      const sun = smooth(0, 25, elevationDeg) * (1 - s.cloud);
      s.wetness = Math.max(0, s.wetness - (dt / DRY_S) * (0.5 + 1.5 * sun));
    }
    s.mist = ease(s.mist, this.mistTarget(t, elevationDeg, evening), dt, MIST);
    return s;
  }

  private mistTarget(t: Target, elevationDeg: number, evening: number): number {
    // After rain the wet ground steams: mist while it's wet and no longer raining.
    const wet = this.state.wetness;
    const afterRain = wet * wet * (1 - smooth(0.05, 0.4, this.state.rain)) * 0.45;
    return clamp01(Math.max(t.mist, naturalMist(elevationDeg, evening) * (1 - t.cloud * 0.4), afterRain));
  }
}
