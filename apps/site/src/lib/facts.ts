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

/** The same eight tasks at level 3 (the harder end of the dial), 16 November 2026: docs/TRIALS.md, run r-mwj8wtir. */
export const TRIALS_HARD = {
  date: "16 November 2026",
  run: "r-mwj8wtir",
  revision: "cb2a259",
  rows: [
    { what: "Solved outright", value: "6 of 8" },
    { what: "Galahad Index", value: `${pct(95)} (90–100 %)` },
    { what: "Called done and wasn't", value: "1 of 7" },
    { what: "Input read from a cache", value: pct(72) },
    { what: "A task, at list prices", value: "$0.39, 237k tokens, 18 minutes" },
  ],
  models: "planner glm-5.3, engineer deepseek-v4-pro, reviewer qwen3.8-max, on a coding plan",
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

/** Side by side on 16 November 2026, each project from its own releases, docs and App Store listing: docs/COMPARISON.md
 * has every source. Short enough for a schedule row; the doc has the whole of each. */
export const COMPARE = {
  date: "16 November 2026",
  columns: ["Runs on", "Each agent's work", "Done when", "On an iPhone", "Chat apps"],
  rows: [
    { name: "Galahad", ours: true, cells: ["Your machines only", "A microVM per knight: KVM, or a Mac's own", "Its gates pass, then a reviewer who didn't do it accepts", "Native, in testing", "None yet"] },
    { name: "Hermes Agent 0.23", ours: false, cells: ["Your machine, or Hermes Cloud", "On the host by default; sandboxes optional", "No enforced gate found", "None official", "About 30"] },
    { name: "Rakazo 0.11", ours: false, cells: ["Your server, or hosted", "A Docker computer per bot; a VM per bot on Apple-silicon Macs", "No enforced gate found", "App Store", "Six"] },
    { name: "OpenMausBot 0.1", ours: false, cells: ["Your machine, a VPS, or its cloud", "Full access by default; a container if you choose", "No gate found", "App Store", "Slack, through its cloud"] },
    { name: "Grok Bot", ours: false, cells: ["Cursor's cloud, in the US", "One microVM per user, shared by their bots", "A model screens risky actions", "App Store", "Slack, Teams, X"] },
    { name: "Dots", ours: false, cells: ["OpenAI's cloud", "A computer per dot, \"not an isolation guarantee\"", "A model screens risky actions", "The ChatGPT app", "Slack, Teams, iMessage, calls"] },
  ],
} as const;

/** What is built, being built and next: docs/PLAN.md's rows in a line each, with the state the plan gives them. */
export const PHASING = {
  date: "17 November 2026",
  rows: [
    { state: "built", what: "Galahad leads in rooms", line: "What you say to a room is his; he brings in only the knights the work needs." },
    { state: "built", what: "Cheaper coding plans", line: "Twelve plans as presets, each used only as far as its vendor's terms allow." },
    { state: "built", what: "His own computer", line: "A VM with a desktop that is his, kept between conversations." },
    { state: "built", what: "What he knows of you", line: "Facts he proposes and you keep, sent with every answer." },
    { state: "built", what: "Roles you make", line: "Choose the models each knight works on; the reviewer stays independent." },
    { state: "built", what: "A budget per task", line: "A task sees what it has spent and stops when it is, a coding tool's own calls included." },
    { state: "built", what: "Photos and files in chat", line: "Send him a screenshot, a log or a file of code, from any app or the terminal." },
    { state: "building", what: "Hooks and tripwires", line: "Your rules halt or refuse a command, or run a check after one; next, before an answer." },
    { state: "building", what: "Contract first", line: "A gate that passes before the work is said to prove nothing; next, the test written first." },
    { state: "building", what: "Trials from your own work", line: "Your verified tasks, worked again and graded by their own gates; next, after every change." },
    { state: "building", what: "The Mac app", line: "Client and node in one, signed and self-updating; it gives a Mac its knights' VMs, behind its firewall, with one password." },
    { state: "building", what: "Computers that grow", line: "VMs grow live today; next, a disk that grows when it runs low." },
    { state: "building", what: "Lean context", line: "Output a later run or edit made stale becomes a line; next, errors since fixed." },
    { state: "next", what: "Checkpoint, rewind and fork", line: "A quest paused, moved, rewound to a step, or forked at a doubt." },
    { state: "next", what: "Event triggers", line: "Work started by a webhook, new mail or a failed CI run, not only a clock." },
    { state: "next", what: "Chat apps", line: "Telegram first, then Slack, Discord, Signal and WhatsApp." },
  ],
} as const;

/** 85k, 467k, 1.19M: how a footprint's length is labelled (two of the four were counted to the thousand, so no row
 * claims more precision than that). */
export function compact(lines: number): string {
  if (lines === 0) return "0";
  if (lines % 1_000_000 === 0) return `${lines / 1_000_000}M`;
  return lines >= 1_000_000 ? `${(lines / 1_000_000).toFixed(2)}M` : `${Math.round(lines / 1000)}k`;
}
