/*
 * The night sky as a panorama. The camera looks at the horizon over Galahad's
 * shoulder and sees only the lowest ten degrees or so of the sky, half of that
 * behind the far hills: drawn where they really stand, the pole star, the
 * moon high in the south and nearly every planet would never be on screen. So
 * everything among the stars (the stars themselves, the Milky Way, the planets,
 * the moon, a meteor's streak) is drawn at its real bearing with its height
 * squeezed into that strip, all by the one function here, so they keep their
 * places beside each other: the moon stands among the right stars.
 *
 * The squeeze: a body rising clears the far hills within a few degrees of
 * real height (HEAVENS_FLOOR), and from there to the zenith the strip is an
 * equal-area projection (the drawn height goes with the sine of the real one),
 * so the stars are spread as evenly over the strip as they are over the sky
 * and never pile up along its top. Bearings are real; shapes are flattened.
 * The strip's top follows the view's: zoomed right in, or on a tall phone
 * screen, the camera sees a few degrees more of sky, and the heavens open out
 * to fill them (`heavensTop`). The sun, the clouds, a rainbow and a halo are not
 * squeezed: they are in the air, where they really are.
 *
 * Pure, so unit-tested; sky.ts and the star field do the same sums on the GPU.
 */

type Vec3 = [number, number, number];

const RAD = Math.PI / 180;

/** The drawn height (radians) the squeeze lifts a just-risen body to: about the top of the far hills. */
export const HEAVENS_FLOOR = 4.8 * RAD;
/** The drawn height of the zenith: the top of the strip of sky the camera sees, as the view opens (and at the least). */
export const HEAVENS_TOP = 10.4 * RAD;
/** The most it opens to (zoomed right in on a tall screen). */
export const HEAVENS_TOP_MOST = 16 * RAD;
/** The zenith is drawn this far under the view's top edge. */
const HEAVENS_MARGIN = 1.1 * RAD;

/**
 * The drawn height of the zenith for a view whose top edge looks `viewTop`
 * radians above the horizon: just under that edge, so the whole sky is in the
 * strip the camera sees, however far it is zoomed in. Never less than the
 * strip as the view opens (looking down from far out, the sky isn't in view at
 * all).
 */
export function heavensTop(viewTop: number): number {
  return Math.max(HEAVENS_TOP, Math.min(HEAVENS_TOP_MOST, viewTop - HEAVENS_MARGIN));
}
/** How fast a rising body climbs to the floor: by e in this much real height. */
export const HEAVENS_RISE = 1.2 * RAD;

/**
 * The height a body among the stars is drawn at for its real height (radians), in a strip whose top is `top`
 * (as the view opens, when left out). Below the horizon nothing changes.
 */
export function seenElevation(elevation: number, top: number = HEAVENS_TOP): number {
  if (elevation <= 0) return elevation;
  return HEAVENS_FLOOR * (1 - Math.exp(-elevation / HEAVENS_RISE)) + (top - HEAVENS_FLOOR) * Math.sin(elevation);
}

/** The real height that's drawn at `seen` (radians): the squeeze undone (Newton's method; it is monotonic). */
export function realElevation(seen: number, top: number = HEAVENS_TOP): number {
  if (seen <= 0) return seen;
  if (seen >= top) return Math.PI / 2;
  // From the equal-area part alone (right above the floor), or the rise alone (below it).
  let e = seen > HEAVENS_FLOOR ? Math.asin(Math.min(1, (seen - HEAVENS_FLOOR) / (top - HEAVENS_FLOOR))) : -HEAVENS_RISE * Math.log(Math.max(1e-9, 1 - seen / (HEAVENS_FLOOR * 1.02)));
  for (let i = 0; i < 12; i++) {
    const slope = (HEAVENS_FLOOR / HEAVENS_RISE) * Math.exp(-e / HEAVENS_RISE) + (top - HEAVENS_FLOOR) * Math.cos(e);
    const step = (seenElevation(e, top) - seen) / Math.max(slope, 1e-6);
    e = Math.max(1e-7, Math.min(Math.PI / 2, e - step));
    if (Math.abs(step) < 1e-10) break;
  }
  return e;
}

/** A horizon-frame unit vector (x east, y north, z up) as it's drawn: the same bearing, its height squeezed. Into `out` (which may be `v`). */
export function seenDirection(v: Readonly<Vec3>, out: Vec3, top: number = HEAVENS_TOP): Vec3 {
  const flat = Math.hypot(v[0], v[1]);
  if (v[2] <= 0 || flat < 1e-9) {
    const seen = v[2] <= 0 ? Math.asin(Math.max(-1, v[2])) : top;
    const c = Math.cos(seen) / (flat || 1);
    out[0] = flat < 1e-9 ? 0 : v[0] * c;
    out[1] = flat < 1e-9 ? Math.cos(seen) : v[1] * c;
    out[2] = Math.sin(seen);
    return out;
  }
  const seen = seenElevation(Math.asin(Math.min(1, v[2])), top);
  const c = Math.cos(seen) / flat;
  out[0] = v[0] * c;
  out[1] = v[1] * c;
  out[2] = Math.sin(seen);
  return out;
}
