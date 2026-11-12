import { COPENHAGEN } from "../sun.ts";
import { azimuthOf, elevationOf, equatorial, type Mat3, rotate, skyMatrix, solarLongitude, type Vec3 } from "./celestial.ts";

/*
 * Meteor showers: the five great ones of the northern year, on their real
 * dates and from their real radiants (the International Meteor Organization's
 * working list, 2026 Meteor Shower Calendar, table 5: weeks of activity, the
 * Sun's longitude at the maximum, the radiant, the speed, the rate at the
 * zenith under a perfect sky). A shower's rate rises and falls about its peak
 * (a sharp peak on a broad foot); what is seen of it depends on how high its
 * radiant stands and how dark the sky is. Each meteor streaks away from the
 * radiant along a great circle, for a fraction of a second.
 *
 * Sparse and brief on purpose: one at a time, and none under reduced motion.
 * Sporadic meteors (the handful an hour of any night) are left out. Drawn from
 * a seeded source, so the same steps give the same night. Pure, unit-tested.
 */

export interface Shower {
  name: string;
  /** The Sun's ecliptic longitude at the maximum, degrees (J2000). */
  peak: number;
  /** The radiant at the maximum: right ascension and declination, degrees. */
  ra: number;
  dec: number;
  /** The zenithal hourly rate at the maximum. */
  zhr: number;
  /** How fast its meteors meet the air, km/s. */
  speed: number;
  /** Its weeks of activity, by Denmark's date: [month, day] first and last. */
  from: readonly [number, number];
  to: readonly [number, number];
  /** How steeply its peak falls away, as powers of ten a degree of the Sun's longitude (about a day). */
  slope: number;
}

export const SHOWERS: readonly Shower[] = [
  { name: "Quadrantids", peak: 283.15, ra: 230, dec: 49, zhr: 80, speed: 41, from: [12, 28], to: [1, 12], slope: 2.5 },
  { name: "Lyrids", peak: 32.32, ra: 271, dec: 34, zhr: 18, speed: 49, from: [4, 14], to: [4, 30], slope: 0.22 },
  { name: "Perseids", peak: 140, ra: 48, dec: 58, zhr: 100, speed: 59, from: [7, 17], to: [8, 24], slope: 0.2 },
  { name: "Leonids", peak: 235.27, ra: 152, dec: 22, zhr: 15, speed: 71, from: [11, 6], to: [11, 30], slope: 0.39 },
  { name: "Geminids", peak: 262.2, ra: 112, dec: 33, zhr: 150, speed: 35, from: [12, 4], to: [12, 20], slope: 0.6 },
];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", month: "2-digit", day: "2-digit" });

/** Month × 100 + day, by Denmark's date. */
function danishDay(ms: number): number {
  let m = 1;
  let d = 1;
  for (const part of PARTS.formatToParts(ms)) {
    if (part.type === "month") m = Number(part.value);
    else if (part.type === "day") d = Number(part.value);
  }
  return m * 100 + d;
}

/** A shower's rate at the zenith under a perfect sky at a UTC instant (meteors an hour): 0 outside its weeks. */
export function showerRate(s: Shower, ms: number): number {
  const day = danishDay(ms);
  const from = s.from[0] * 100 + s.from[1];
  const to = s.to[0] * 100 + s.to[1];
  const inside = from <= to ? day >= from && day <= to : day >= from || day <= to;
  if (!inside) return 0;
  // Degrees of the Sun's longitude from the peak, the short way round.
  const off = Math.abs(((solarLongitude(ms) * DEG - s.peak + 540) % 360) - 180);
  // A sharp peak on a broad, low foot (the days either side of the maximum still give a few).
  return s.zhr * (0.85 * 10 ** (-s.slope * off) + 0.15 * 10 ** (-0.08 * off));
}

export interface ShowerNow {
  shower: Shower;
  /** Its zenithal rate now (0 outside its weeks). */
  rate: number;
  /** Its radiant now over the horizon: height and compass bearing, radians. */
  elevation: number;
  azimuth: number;
  /** The radiant as a unit vector in the horizon's frame (x east, y north, z up). */
  radiant: Vec3;
}

export const emptyShowers = (): ShowerNow[] => SHOWERS.map((shower) => ({ shower, rate: 0, elevation: 0, azimuth: 0, radiant: [0, 0, 1] }));

const matrix: Mat3 = new Float64Array(9);
const place: Vec3 = [0, 0, 0];

/** Every shower at a UTC instant, seen from (lat, lon) in degrees: written into `out` (emptyShowers()). */
export function showersAt(ms: number, out: ShowerNow[], lat: number = COPENHAGEN.lat, lon: number = COPENHAGEN.lon): ShowerNow[] {
  skyMatrix(ms, matrix, lat, lon);
  for (const now of out) {
    const s = now.shower;
    now.rate = showerRate(s, ms);
    rotate(matrix, equatorial(s.ra * RAD, s.dec * RAD, place), now.radiant);
    now.elevation = elevationOf(now.radiant);
    now.azimuth = azimuthOf(now.radiant);
  }
  return out;
}

/** A shower worth a word tonight, and how much of one: at its peak, well under way, or only a few. */
export interface Tonight {
  shower: Shower;
  strength: "peak" | "active" | "few";
}

const tonight: Tonight = { shower: SHOWERS[0]!, strength: "few" };

/** The shower to name on the night of a UTC instant (the busiest that is in its weeks), or null. One object, reused. */
export function showerTonight(ms: number): Tonight | null {
  let best: Shower | null = null;
  let most = 0;
  for (const s of SHOWERS) {
    // The best of the coming hours, so an evening says what the night brings.
    let rate = 0;
    for (let h = 0; h <= 8; h += 2) rate = Math.max(rate, showerRate(s, ms + h * 3_600_000));
    if (rate > most) {
      most = rate;
      best = s;
    }
  }
  if (!best || most < 0.2) return null;
  tonight.shower = best;
  tonight.strength = most >= best.zhr * 0.4 ? "peak" : most >= Math.max(3, best.zhr * 0.1) ? "active" : "few";
  return tonight;
}

/** For every meteor an hour a watcher would count under a perfect sky, this many fall over the whole sky. */
const WHOLE_SKY = 3;
/** A meteor burns about this high (km): its speed across the sky is its speed over this, by how far off the radiant it is. */
const HEIGHT_KM = 100;

export class Meteors {
  /** Whether a meteor is in the sky now. */
  alive = false;
  /** Where it began and where it ends: unit vectors in the horizon's frame (x east, y north, z up), real heights. */
  readonly from: Vec3 = [0, 0, 1];
  readonly to: Vec3 = [0, 0, 1];
  /** Seconds since it began, and how long it lasts. */
  age = 0;
  life = 0;
  /** How bright, 0..1 (most are faint). */
  bright = 0;
  /** Its shower's name. */
  shower = "";
  /** Counts them (a new number: a new meteor). */
  count = 0;
  private readonly showers = emptyShowers();
  /** When the showers were last worked out (ms), and the rate they give over the whole sky (meteors a second). */
  private placedAt = Number.NEGATIVE_INFINITY;
  private rate = 0;
  private s: number;

  constructor(seed = 20261111) {
    this.s = seed >>> 0 || 1;
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
   * Moves on by `dt` seconds at the UTC instant `ms`, under a sky `dark` (0 day
   * .. 1 a clear night). With `motion` false there are none and no time
   * passes. Returns whether a meteor is in the sky.
   */
  step(dt: number, ms: number, dark: number, motion: boolean): boolean {
    if (!motion) {
      this.alive = false;
      return false;
    }
    if (this.alive) {
      this.age += dt;
      if (this.age >= this.life) this.alive = false;
      return this.alive;
    }
    if (dark <= 0.01) return false;
    // The showers move slowly: placed again every ten seconds.
    if (Math.abs(ms - this.placedAt) > 10_000) {
      this.placedAt = ms;
      showersAt(ms, this.showers);
      let total = 0;
      for (const now of this.showers) total += now.rate * Math.max(0, Math.sin(now.elevation));
      this.rate = (total * WHOLE_SKY) / 3600;
    }
    if (this.rate <= 0 || this.random() >= this.rate * dark * dt) return false;
    // Which shower's: by its share of what's falling.
    let pick = (this.random() * this.rate * 3600) / WHOLE_SKY;
    let chosen = this.showers[0]!;
    for (const now of this.showers) {
      const share = now.rate * Math.max(0, Math.sin(now.elevation));
      if (share <= 0) continue;
      chosen = now;
      pick -= share;
      if (pick <= 0) break;
    }
    const r = chosen.radiant;
    // Where it begins: anywhere well above the horizon, not right at the radiant.
    const f = this.from;
    let away = 0;
    for (let tries = 0; tries < 8; tries++) {
      const z = 0.09 + 0.91 * this.random();
      const bearing = this.random() * 2 * Math.PI;
      const flat = Math.sqrt(1 - z * z);
      f[0] = flat * Math.sin(bearing);
      f[1] = flat * Math.cos(bearing);
      f[2] = z;
      away = Math.acos(Math.max(-1, Math.min(1, f[0] * r[0] + f[1] * r[1] + f[2] * r[2])));
      if (away > 0.14 && away < 2.2) break;
    }
    if (!(away > 0.14 && away < 2.2)) return false;
    // The way it goes: along the great circle from the radiant through where it began, away from the radiant.
    const cos = Math.cos(away);
    let tx = f[0] * cos - r[0];
    let ty = f[1] * cos - r[1];
    let tz = f[2] * cos - r[2];
    const n = Math.hypot(tx, ty, tz) || 1;
    tx /= n;
    ty /= n;
    tz /= n;
    // Short near the radiant (it comes at you), long far from it; faster showers cross the sky faster.
    const sin = Math.sin(away);
    const length = (0.1 + 0.3 * this.random()) * (0.25 + 0.75 * sin);
    const across = (chosen.shower.speed / HEIGHT_KM) * (0.3 + 0.7 * sin);
    this.to[0] = f[0] * Math.cos(length) + tx * Math.sin(length);
    this.to[1] = f[1] * Math.cos(length) + ty * Math.sin(length);
    this.to[2] = f[2] * Math.cos(length) + tz * Math.sin(length);
    this.life = Math.max(0.25, Math.min(1.3, length / across + 0.15));
    this.age = 0;
    // Most are faint; one in a few is bright.
    const b = this.random();
    this.bright = 0.35 + 0.65 * b * b;
    this.shower = chosen.shower.name;
    this.alive = true;
    this.count++;
    return true;
  }
}
