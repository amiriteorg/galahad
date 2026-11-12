/* Small numbers the ecosystem's files share. Pure. */

export const TAU = Math.PI * 2;

export const clamp = (x: number, lo = 0, hi = 1): number => (x < lo ? lo : x > hi ? hi : x);

/** The shortest turn from heading a to heading b (radians, −π..π). */
export const turnTo = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
};

export const smooth = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
