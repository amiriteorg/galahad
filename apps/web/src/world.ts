/*
 * The SANDBOX's 3D world, as its own bundle (/world.js): three.js stays out of
 * app.js and is fetched only when the page is opened. The page (views/world.ts)
 * imports this module by URL and talks to it through the handle below.
 */

export { createDemo } from "./world/demo.ts";
export { mountWorld } from "./world/scene.ts";
export { lowerTier } from "./world/tiers.ts";
export { TIME_PRESETS } from "./world/daynight.ts";

/** Bumped when the page and this bundle must change together (a cached old bundle is then refused). */
export const WORLD_API = 1;
