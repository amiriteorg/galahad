import type { TierName } from "../../apps/web/src/world/tiers.ts";
import type { Suite } from "../lib.ts";
import { type Audit, auditGeometry, auditObject, emptyAudit } from "../models/audit.ts";
import { type Builder, BUILDERS, ofTier } from "../models/builders.ts";

/*
 * The procedural models: is every mesh the world's code makes sound? Each
 * builder is run headless, for each device tier it builds differently, and what
 * it made is read as it would be drawn (bench/models/audit.ts): no triangle
 * without area, no number that isn't one, no closed part inside out or with
 * normals pointing in, no two faces in one place in different colours (they
 * clash), skin weights that sum to one on bones that exist, a size and a
 * footing that make sense for what the thing is, a triangle count within its
 * stated budget (bench/models/builders.ts), and the same mesh every time.
 *
 * The four real robots are brought in from their own descriptions (their
 * meshes simplified by scripts/robots/build.ts), not made by this code: they're
 * audited the same way and counted apart.
 */

interface Result {
  id: string;
  builder: Builder;
  tier: TierName;
  audit: Audit;
  /** Built twice, the same mesh both times. */
  same: boolean;
  /** What about its size or footing doesn't fit what it is. */
  misfit: string | null;
  budget: number;
}

async function build(builder: Builder, tier: TierName): Promise<{ audit: Audit; bounds: Audit }> {
  const built = await builder.build(tier);
  const audit = emptyAudit();
  if (built.root) auditObject(built.root, audit);
  for (const g of built.geometries ?? []) auditGeometry(g, audit);
  // A body's size and footing are its own, not those of what it carries.
  const bounds = builder.body && built.root ? auditObject(built.root, emptyAudit(), "skinned") : audit;
  built.dispose?.();
  return { audit, bounds };
}

export const suite: Suite = {
  name: "procedural-models",
  about: "every mesh the world's code makes, built headless and read as it would be drawn: is it sound?",
  headline: [
    "models.count",
    "models.triangles",
    "models.non-finite",
    "models.degenerate-triangles",
    "models.inside-out-parts",
    "models.inward-normals",
    "models.clashing-faces",
    "models.redundant-faces",
    "models.bad-skin-weights",
    "models.misfits",
    "models.over-budget",
    "models.nondeterministic",
    "models.imported.degenerate-triangles",
    "models.imported.clashing-faces",
    "models.build.knight",
    "models.build.workshop",
  ],
  async run(ctx) {
    const results: Result[] = [];
    for (const builder of BUILDERS) {
      for (const tier of builder.tiers ?? (["high"] as const)) {
        const { audit, bounds } = await build(builder, tier);
        const again = await build(builder, tier);
        ctx.pulse();
        const height = bounds.max[1] - bounds.min[1];
        const lowest = bounds.min[1];
        const misfit =
          builder.height && (height < builder.height[0] || height > builder.height[1])
            ? `${height.toFixed(2)} m tall (expected ${builder.height[0]} to ${builder.height[1]})`
            : builder.base && (lowest < builder.base[0] || lowest > builder.base[1])
              ? `its lowest point at ${lowest.toFixed(2)} m (expected ${builder.base[0]} to ${builder.base[1]})`
              : null;
        // (A metric's name is lower case: farBroad is far-broad.)
        const name = builder.name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        results.push({ id: `${name}${builder.tiers ? `.${tier}` : ""}`, builder, tier, audit, same: again.audit.digest === audit.digest && again.audit.triangles === audit.triangles, misfit, budget: ofTier(builder.budget, tier) });
      }
    }
    const made = results.filter((r) => !r.builder.imported);
    const imported = results.filter((r) => r.builder.imported);
    const sum = (set: Result[], pick: (a: Audit) => number): number => set.reduce((total, r) => total + pick(r.audit), 0);
    /** The models with any of it, the most first: for whoever goes looking. */
    const who = (set: Result[], pick: (a: Audit) => number): string => {
      const with_ = set.filter((r) => pick(r.audit) > 0).sort((a, b) => pick(b.audit) - pick(a.audit));
      return with_.length ? `: ${with_.slice(0, 6).map((r) => `${r.id} ${pick(r.audit)}`).join(", ")}${with_.length > 6 ? `, and ${with_.length - 6} more` : ""}` : "";
    };
    const cut = (text: string): string => text.slice(0, 290);

    ctx.quality("models.count", made.length, "models", "higher", { note: `built and audited, of ${BUILDERS.filter((b) => !b.imported).length} builders (each tier a builder builds differently is its own)` });
    ctx.quality("models.triangles", sum(made, (a) => a.triangles), "triangles", "lower", { resolution: sum(made, (a) => a.triangles) * 0.05, note: "every model made by code, added up (a change of less than a twentieth isn't called one)" });
    ctx.quality("models.non-finite", sum(made, (a) => a.nonFinite), "", "lower", { note: cut(`positions, normals or weights that aren't numbers${who(made, (a) => a.nonFinite)}`) });
    ctx.quality("models.degenerate-triangles", sum(made, (a) => a.degenerate), "triangles", "lower", { note: cut(`triangles of no area${who(made, (a) => a.degenerate)}`) });
    ctx.quality("models.inside-out-parts", sum(made, (a) => a.insideOut), "parts", "lower", { note: cut(`closed parts wound inside out, of ${sum(made, (a) => a.closedParts)}${who(made, (a) => a.insideOut)}`) });
    ctx.quality("models.inward-normals", sum(made, (a) => a.inwardNormals), "triangles", "lower", { note: cut(`triangles of closed parts whose normals point in${who(made, (a) => a.inwardNormals)}`) });
    const clashingAt = made.filter((r) => r.audit.clashingAt.length).slice(0, 2).map((r) => `${r.id} at ${r.audit.clashingAt[0]}`);
    ctx.quality("models.clashing-faces", sum(made, (a) => a.clashing), "triangles", "lower", { note: cut(`two faces in one place, the same way round, in different colours${who(made, (a) => a.clashing)}${clashingAt.length ? `; e.g. ${clashingAt.join("; ")}` : ""}`) });
    ctx.quality("models.redundant-faces", sum(made, (a) => a.redundant), "triangles", "lower", { note: cut(`a face drawn twice in the same colour: nothing shows, the second is wasted${who(made, (a) => a.redundant)}`) });
    ctx.quality("models.bad-skin-weights", sum(made, (a) => a.badWeights + a.badBones), "vertices", "lower", { note: cut(`of ${sum(made, (a) => a.skinned)} skinned vertices: weights that don't sum to one, or a bone that isn't there${who(made, (a) => a.badWeights + a.badBones)}`) });
    const misfits = made.filter((r) => r.misfit);
    ctx.quality("models.misfits", misfits.length, "models", "lower", { note: cut(`a size or a footing that doesn't fit what the thing is${misfits.length ? `: ${misfits.slice(0, 4).map((r) => `${r.id} ${r.misfit}`).join("; ")}` : ""}`) });
    const over = results.filter((r) => r.audit.triangles > r.budget);
    ctx.quality("models.over-budget", over.length, "models", "lower", { note: cut(`more triangles than its stated budget${over.length ? `: ${over.slice(0, 5).map((r) => `${r.id} ${r.audit.triangles} of ${r.budget}`).join(", ")}` : ""}`) });
    const differing = results.filter((r) => !r.same);
    ctx.quality("models.nondeterministic", differing.length, "models", "lower", { note: cut(`built twice, a different mesh${differing.length ? `: ${differing.map((r) => r.id).slice(0, 8).join(", ")}` : ""}`) });

    // The real robots' meshes, as the build left them.
    ctx.quality("models.imported.triangles", sum(imported, (a) => a.triangles), "triangles", "lower", { note: cut(imported.map((r) => `${r.id.replace("robot.", "")} ${r.audit.triangles} of ${r.budget}`).join(", ")) });
    ctx.quality("models.imported.degenerate-triangles", sum(imported, (a) => a.degenerate), "triangles", "lower", { note: cut(`triangles of no area${who(imported, (a) => a.degenerate)}`) });
    ctx.quality("models.imported.inside-out-parts", sum(imported, (a) => a.insideOut), "parts", "lower", { note: cut(`closed parts wound inside out, of ${sum(imported, (a) => a.closedParts)}${who(imported, (a) => a.insideOut)}`) });
    ctx.quality("models.imported.clashing-faces", sum(imported, (a) => a.clashing), "triangles", "lower", { note: cut(`two faces in one place in different colours${who(imported, (a) => a.clashing)}`) });
    ctx.quality("models.imported.redundant-faces", sum(imported, (a) => a.redundant), "triangles", "lower", { note: cut(`a face drawn twice in the same colour${who(imported, (a) => a.redundant)}`) });

    // How much of its budget each uses: a model that grows by more than 15 % of it is noticed, and one that's over is counted above.
    for (const r of results) ctx.quality(`models.${r.id}.budget-used`, r.audit.triangles / r.budget, "", "lower", { resolution: 0.15, note: `${r.audit.triangles} triangles of ${r.budget}, ${r.audit.vertices} vertices, ${r.audit.meshes} mesh${r.audit.meshes === 1 ? "" : "es"}${r.audit.skinned ? `, ${r.audit.skinned} skinned vertices` : ""}` });

    // What the big ones cost to build (once, when the page opens).
    for (const [name, tier] of [["knight", "high"], ["keep", "high"], ["proving-ground", "high"], ["workshop", "high"]] as const) {
      const builder = BUILDERS.find((b) => b.name === name)!;
      ctx.time(`models.build.${name}`, () => {
        const built = builder.build(tier) as { dispose?(): void };
        built.dispose?.();
      }, { n: 5, warm: 1, note: `building ${name === "knight" || name === "keep" ? `the ${name}` : `the ${name}, high tier`}, as the page does when it opens` });
    }
    ctx.log(`${results.length} models: ${sum(results, (a) => a.triangles).toLocaleString("en-US")} triangles`);
  },
};
