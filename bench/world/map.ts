import { BUILDS, Solids } from "../../apps/web/src/world/collide.ts";
import { ProvingGround } from "../../apps/web/src/world/field.ts";
import { addPlants } from "../../apps/web/src/world/flora-plan.ts";
import { Workshop } from "../../apps/web/src/world/hall.ts";
import { HEARTH_COLLIDERS } from "../../apps/web/src/world/hearth-plan.ts";
import { KEEP_COLLIDERS } from "../../apps/web/src/world/keep-plan.ts";
import { Planner } from "../../apps/web/src/world/nav.ts";
import { built } from "../../apps/web/src/world/path.ts";
import type { Place } from "../../apps/web/src/world/place.ts";
import { SITE_COLLIDERS } from "../../apps/web/src/world/sites.ts";
import { BASE_FLATS, BIG, CHUNK, type ChunkSamples, chunkSamples, heightAt, SEED, waterAt } from "../../apps/web/src/world/terrain.ts";
import { TIERS } from "../../apps/web/src/world/tiers.ts";

/*
 * The real map, headless: the land as it's grown from the world's own seed, and
 * everything solid on the home ground (the keep and its stations, his hearth, the
 * two sites with their buildings and machines where they stand, every tree and
 * rock the land grows), as the page's own walking test assembles it. No GPU: the
 * places are built for their plans and colliders only.
 */

/** The home ground: from the proving ground to the hall, and out past the lake (world metres). */
export const HOME = { x0: -230, y0: -150, x1: 150, y1: 130 } as const;

export const flats = BASE_FLATS;
export const ground = (x: number, y: number): number => heightAt(SEED, x, y, flats);
/** Ground a walker won't set foot on (the page's own rule: within 5 cm of the water's level, or under it). */
export const wet = (x: number, y: number): boolean => heightAt(SEED, x, y, flats) < waterAt(SEED, x, y, flats) + 0.05;

export interface RealMap {
  solids: Solids;
  planner: Planner;
  /** The big layers of every chunk of the home ground (trees, bushes, rocks, reeds). */
  chunks: ChunkSamples[];
  walker: (typeof BUILDS)["galahad"];
}

export function buildMap(): RealMap {
  const solids = new Solids();
  solids.add(KEEP_COLLIDERS);
  solids.add(HEARTH_COLLIDERS, ground);
  solids.add(SITE_COLLIDERS, ground);
  const context = { tier: TIERS.medium, shadows: false, ground };
  for (const place of [new ProvingGround(context), new Workshop(context)] as Place[]) {
    solids.add(place.colliders, ground);
    // Their machines where they stand to begin with (they move in the world; here, still).
    solids.add((place.movers ?? []).filter((m) => m.r > 0).map((m) => ({ kind: "circle" as const, x: m.x, y: m.y, r: m.r, top: 3 })), ground);
    place.dispose();
  }
  const chunks: ChunkSamples[] = [];
  for (let cx = Math.floor(HOME.x0 / CHUNK); cx <= Math.floor(HOME.x1 / CHUNK); cx++) {
    for (let cy = Math.floor(HOME.y0 / CHUNK); cy <= Math.floor(HOME.y1 / CHUNK); cy++) {
      const s = chunkSamples(SEED, cx, cy, flats, built, BIG);
      addPlants(solids, s.layers.trees, s.layers.rocks);
      chunks.push(s);
    }
  }
  return { solids, planner: new Planner(solids), chunks, walker: BUILDS.galahad };
}
