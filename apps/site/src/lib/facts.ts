/*
 * What the site says as fact, in one place, each with where it comes from. The build reads what it can (the installer,
 * its Bun pin, the commit); the measured numbers carry their date and source and change only when measured again.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import installer from "../../../../scripts/install.sh?raw";
import pin from "../../../../scripts/bun-pin.sh?raw";

export const REPO = "https://github.com/amiriteorg/galahad";
export const DOCS = `${REPO}/tree/main/docs`;
export const doc = (name: string, anchor = "") => `${REPO}/blob/main/docs/${name}.md${anchor}`;

export const INSTALL = "curl -fsSL https://galahad.sh | bash";
/** The script /install.sh serves (src/pages/install.sh.ts serves exactly this text). */
export const INSTALLER = installer;
export const INSTALLER_SHA256 = createHash("sha256").update(installer).digest("hex");
export const BUN_VERSION = /^BUN_VERSION=([0-9.]+)$/m.exec(pin)?.[1] ?? "";

/** The commit the site was built from, for its title block; nothing when it isn't built from a checkout. */
export const COMMIT = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
})();

const pct = (n: number) => `${n} %`;

/** The agentic trials of 14 November 2026: the table at the top of docs/TRIALS.md, both of its runs, every row. */
export const TRIALS = {
  date: "14 November 2026",
  runs: ["6bbab45", "4c89fc0"],
  rows: [
    { what: "Solved outright", values: ["7 of 7 scored (1 crashed)", "6 of 8"] },
    { what: "Galahad Index", href: doc("TRIALS", "#the-galahad-index"), values: [pct(100), `${pct(94)} (88–100 %)`] },
    { what: "Called done and wasn't", values: ["0 of 5", "1 of 7"] },
    { what: "Input read from a cache", values: [pct(2), pct(73)] },
    { what: "A task, at list prices", values: ["$1.05, 442k tokens, 24.5 minutes", "$0.54, 258k tokens, 17 minutes"] },
  ],
  models: "planner and engineer glm-5.3, reviewer qwen3.8-max, on a coding plan",
} as const;

/** Lines of source, test files left out, counted with `git ls-files` on 15 November 2026. Galahad's at `commit`;
 * Hermes Agent's at its 0.21 checkout; Rakazo's and OpenMausBot's from their main branches that day, to the thousand. */
export const SIZE = {
  date: "15 November 2026",
  commit: "deaa43c",
  rows: [
    { name: "Galahad", lines: 84_819, exact: true, of: "TypeScript (76,230) and Swift (8,589)", ours: true },
    { name: "Rakazo", lines: 467_000, exact: false, of: "TypeScript", ours: false },
    { name: "OpenMausBot", lines: 571_000, exact: false, of: "TypeScript and JavaScript", ours: false },
    { name: "Hermes Agent", lines: 1_192_697, exact: true, of: "Python (720,605) and TypeScript (472,092), version 0.21", ours: false },
  ],
} as const;

/** 85k, 467k, 1.19M: how a footprint's length is labelled (two of the four were counted to the thousand, so no row
 * claims more precision than that). */
export function compact(lines: number): string {
  if (lines === 0) return "0";
  if (lines % 1_000_000 === 0) return `${lines / 1_000_000}M`;
  return lines >= 1_000_000 ? `${(lines / 1_000_000).toFixed(2)}M` : `${Math.round(lines / 1000)}k`;
}
