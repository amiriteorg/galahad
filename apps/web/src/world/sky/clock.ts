/*
 * The instant the sky is drawn for: now, always, the real one (never the
 * device's zone: everything is worked out from UTC milliseconds). For tours and
 * for looking at a night you missed, `?sky=2026-08-12T23:30:00Z` on the page
 * moves the whole sky (the sun, the moon, the stars, the planets, the meteors)
 * to that instant, and it runs on from there.
 */

let offset: number | null = null;

/** How far the sky's clock is moved from the real one (ms): 0 unless the page asks with `?sky=`. */
function skyOffset(): number {
  if (offset !== null) return offset;
  offset = 0;
  try {
    const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("sky");
    const at = asked ? Date.parse(asked) : Number.NaN;
    if (Number.isFinite(at)) offset = at - Date.now();
  } catch {
    offset = 0;
  }
  return offset;
}

/** The UTC instant the sky shows (ms). */
export const skyNow = (): number => Date.now() + skyOffset();
