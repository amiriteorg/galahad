/*
 * The windsock and the weather mast, read off the wind: how far each band of
 * the sock fills, which way it points, and how it shivers in gusts; how fast
 * the anemometer's cups go round. An airfield's windsock is made so that each
 * of its five bands fills at another three knots: limp in a calm, the first
 * band out at 3 kt, straight out from 15 kt (7.7 m/s). Pure.
 */

/** Its bands, and the wind (m/s) at which each one stands out: 3 knots apiece. */
export const SOCK_BANDS = 5;
export const KNOT = 0.5144;
export const BAND_WIND = 3 * KNOT;

export interface SockPose {
  /** The way it points (atan2: downwind, the way the wind blows towards). */
  heading: number;
  /** Each band's droop below the level (radians, 0 straight out). */
  droop: Float64Array;
  /** Each band's sideways swing (radians, left +). */
  swing: Float64Array;
}

export const sockPose = (): SockPose => ({ heading: 0, droop: new Float64Array(SOCK_BANDS), swing: new Float64Array(SOCK_BANDS) });

/** How far band i stands out in a wind of `speed` m/s: 0 hanging, 1 out. */
export const bandFill = (speed: number, i: number): number => Math.max(0, Math.min(1, speed / BAND_WIND - i));

/** The most a limp band hangs (radians below the level). */
const LIMP = 1.25;

/**
 * The sock in a wind of `speed` m/s towards `windHeading` at time t (seconds): bands out as far as the wind
 * fills them, each hanging further than the one before; a slow wander of its heading and a quick shiver that
 * grow with the wind (`motion` false: none). Writes into `out`.
 */
export function windsock(speed: number, windHeading: number, t: number, motion: boolean, out: SockPose): SockPose {
  const gust = motion ? Math.min(1, speed / 9) : 0;
  out.heading = windHeading + (motion ? (0.12 + 0.1 * gust) * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1.1) : 0);
  let droop = 0;
  for (let i = 0; i < SOCK_BANDS; i++) {
    const fill = bandFill(speed, i);
    // Each band hangs from the one before it: its droop is the sum of what's limp so far.
    droop = Math.min(LIMP, droop + (1 - fill) * (LIMP / 2.2) + (i === 0 ? (1 - fill) * 0.35 : 0));
    const shiver = motion ? gust * (0.03 + 0.025 * i) * Math.sin(t * (6.3 + i * 1.7) + i * 0.9) : 0;
    out.droop[i] = droop + shiver * 0.6;
    out.swing[i] = shiver + (motion ? 0.05 * (1 - fill) * Math.sin(t * 0.9 + i) : 0);
  }
  return out;
}

/** The anemometer's cups go round at about a third of the wind's speed at their radius (rad/s). */
export const cupSpeed = (speed: number, radius: number): number => speed / (3 * radius);
