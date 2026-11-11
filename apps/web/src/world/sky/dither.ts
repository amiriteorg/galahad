import { dot, fract, screenCoordinate, sin, vec2 } from "three/tsl";

/** Half a step of 8-bit colour, as noise on the screen: no bands in long gradients. */
export function dither() {
  return fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5).mul(1 / 255);
}
