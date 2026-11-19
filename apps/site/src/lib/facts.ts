/*
 * What the site says as fact, in one place, each with where it comes from. The build reads what it can (the installer,
 * its Bun pin, the commit); the measured numbers carry their date and source and change only when measured again.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import installer from "../../../../scripts/install.sh?raw";
import pin from "../../../../scripts/bun-pin.sh?raw";
import appcast from "../../public/mac/appcast.xml?raw";

export const REPO = "https://github.com/amiriteorg/galahad";
export const DOCS = `${REPO}/tree/main/docs`;
export const doc = (name: string, anchor = "") => `${REPO}/blob/main/docs/${name}.md${anchor}`;

export const INSTALL = "curl -fsSL https://galahad.sh | bash";
/** The script /install.sh serves (src/pages/install.sh.ts serves exactly this text). */
export const INSTALLER = installer;
export const INSTALLER_SHA256 = createHash("sha256").update(installer).digest("hex");
export const BUN_VERSION = /^BUN_VERSION=([0-9.]+)$/m.exec(pin)?.[1] ?? "";

/**
 * Galahad for Mac as its update feed offers it (public/mac/appcast.xml, which apps/apple/scripts/mac-release.sh writes
 * with each build): the newest notarized build, linked where it is published, so the page and the app's own updates
 * always name the same one. A feed it can't read fails the build, rather than a page with a broken download.
 */
export const MAC = (() => {
  const field = (pattern: RegExp): string => {
    const found = pattern.exec(appcast)?.[1];
    if (!found) throw new Error(`the Mac's feed (public/mac/appcast.xml) has no ${pattern.source}`);
    return found;
  };
  const url = field(/<enclosure\b[^>]*\burl="([^"]+)"/);
  if (!url.startsWith(`${REPO}/releases/download/`)) throw new Error(`the Mac's feed links outside the repository's releases: ${url}`);
  return {
    version: field(/<sparkle:shortVersionString>([^<]+)</),
    build: field(/<sparkle:version>([^<]+)</),
    macOS: field(/<sparkle:minimumSystemVersion>([^<]+)</).replace(/\.0$/, ""),
    url,
    size: `${Math.round(Number(field(/<enclosure\b[^>]*\blength="(\d+)"/)) / 1e6)} MB`,
    date: new Date(field(/<pubDate>([^<]+)<\/pubDate>/)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
  };
})();
/** Every build published, each with what changed. */
export const RELEASES = `${REPO}/releases`;

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

/** Lines of source, test files left out, counted with `git ls-files`: Galahad's at `commit` on `oursDate` (the same count
 * at deaa43c, on 15 November, gave the 84,819 first shown here); Hermes Agent's at its 0.21 checkout, and Rakazo's and
 * OpenMausBot's from their main branches, on `date`, to the thousand. */
export const SIZE = {
  date: "15 November 2026",
  oursDate: "18 November 2026",
  commit: "7f3eb2b",
  rows: [
    { name: "Galahad", lines: 106_902, exact: true, of: "TypeScript (90,222) and Swift (16,680)", ours: true },
    { name: "Rakazo", lines: 467_000, exact: false, of: "TypeScript", ours: false },
    { name: "OpenMausBot", lines: 571_000, exact: false, of: "TypeScript and JavaScript", ours: false },
    { name: "Hermes Agent", lines: 1_192_697, exact: true, of: "Python (720,605) and TypeScript (472,092), version 0.21", ours: false },
  ],
} as const;

/** Side by side, each project from its own releases, docs and App Store listing (read 16 November 2026; Rakazo's and
 * Grok Bot's again on 19 November, and every project's releases since): docs/COMPARISON.md has every source. Short
 * enough for a schedule row; the doc has the whole of each. */
export const COMPARE = {
  date: "19 November 2026",
  columns: ["Runs on", "Each agent's work", "Done when", "On an iPhone", "Chat apps"],
  rows: [
    { name: "Galahad", ours: true, cells: ["Your machines only", "A microVM per knight: KVM, or a Mac's own", "Its gates pass, then a reviewer who didn't do it accepts", "Native, in testing", "Telegram"] },
    { name: "Hermes Agent 0.23", ours: false, cells: ["Your machine, or Hermes Cloud", "On the host by default; sandboxes optional", "No enforced gate found", "None official", "About 30"] },
    { name: "Rakazo 0.13", ours: false, cells: ["Your server, or hosted", "A Docker computer per bot; a VM per bot on Apple-silicon Macs", "No enforced gate found", "App Store", "Six"] },
    { name: "OpenMausBot 0.1", ours: false, cells: ["Your machine, a VPS, or its cloud", "Full access by default; a container if you choose", "No gate found", "App Store", "Slack, through its cloud"] },
    { name: "Grok Bot", ours: false, cells: ["Cursor's cloud, in the US", "One microVM per user, shared by their bots", "A model screens risky actions", "App Store", "Slack, Teams, X"] },
    { name: "Dots", ours: false, cells: ["OpenAI's cloud", "A computer per dot, \"not an isolation guarantee\"", "A model screens risky actions", "The ChatGPT app", "Slack, Teams, iMessage, calls"] },
  ],
} as const;

/** What is built, being built and next: docs/PLAN.md's rows in a line each, with the state the plan gives them, in its order. */
export const PHASING = {
  date: "19 November 2026",
  rows: [
    { state: "built", what: "Edit before you approve", line: "An approval's words are yours to change before your yes: your version is what's sent." },
    { state: "built", what: "Outcomes he owns", line: "A result you give him for days or weeks: he plans it, gives his knights tasks within its budget, and reports daily." },
    { state: "built", what: "CI and review back to the knight", line: "A shipped pull request that fails its checks, or a review that asks for changes, goes back to the knight who did it." },
    { state: "built", what: "Event triggers", line: "Work started by a signed webhook, new mail, or a GitHub run, push, issue or pull request, not only a clock." },
    { state: "built", what: "The workspace beside the chat", line: "A knight's files and what its task changed, beside its conversation: read only, keys redacted before they leave its VM." },
    { state: "built", what: "A usage meter", line: "What the models have cost today or this month, against a budget of yours: a line to watch, never a stop." },
    { state: "built", what: "The Inbox cleared by you", line: "Everything in it leaves when you say so, a swipe on a phone; a yes is still a deliberate press." },
    { state: "built", what: "Galahad leads in rooms", line: "What you say to a room is his; he brings in only the knights the work needs." },
    { state: "built", what: "Cheaper coding plans", line: "Twelve plans as presets, each used only as far as its vendor's terms allow." },
    { state: "built", what: "Audited, not capped", line: "A knight's run has no limit of time, commands or what it can see; an independent audit keeps it on its task and never ends it." },
    { state: "built", what: "A budget per task", line: "A task sees what it has spent and stops when it is; it runs only on models whose spend it can count." },
    { state: "built", what: "His own computer", line: "A VM with a desktop that is his, kept between conversations." },
    { state: "built", what: "Photos and files in chat", line: "Send him a screenshot, a log or a file of code, from any app or the terminal." },
    { state: "built", what: "A chat to work in", line: "Reply to a line, edit, ask again; code coloured and numbered; pictures to zoom; @ for the knights in a room." },
    { state: "built", what: "What he knows of you", line: "Facts he proposes and you keep, sent with every answer." },
    { state: "built", what: "Roles you make", line: "Choose the models each knight works on, a local one on whichever of your machines serves it; the reviewer stays independent." },
    { state: "building", what: "Galahad writes first", line: "Ship it and give again from a task's card, \"tell me when\", and what happened while you were away; next, work for idle knights from your backlog." },
    { state: "building", what: "Count the north star", line: "Each time you step in on a knight's task, counted per task done and verified, and per outcome; next, in the trials." },
    { state: "building", what: "A knight that keeps the books", line: "Bilag from your mail to Drive on their own, and drafts in Dinero; booking always asks." },
    { state: "building", what: "Chat apps", line: "Telegram and Buzz communities are built; next, Telegram's rooms and files, then Slack." },
    { state: "building", what: "Computers that grow", line: "VMs grow live today; next, a disk that grows when it runs low." },
    { state: "building", what: "Each step thinks as it needs", line: "A routine turn thinks less and a hard one more, said inside the conversation so its cache holds; a role's level is yours to pin." },
    { state: "building", what: "Lean context", line: "A knight reads whole files and keeps them in view; what a later run or edit made stale becomes a line. Next, errors since fixed." },
    { state: "building", what: "Contract first", line: "A gate that passes before the work is said to prove nothing; next, the test written first." },
    { state: "building", what: "Hooks and tripwires", line: "Your rules halt or refuse a command, run a check after one, or tell you it ran; next, before an answer." },
    { state: "building", what: "Trials from your own work", line: "Your verified tasks, worked again and graded by their own gates; next, after every change." },
    { state: "building", what: "The Mac app", line: "Client and node in one, signed and self-updating; it gives a Mac its knights' VMs, behind its firewall, with one password, and lends Galahad the Mac itself in sessions you allow." },
    { state: "next", what: "Checkpoint, rewind and fork", line: "A quest paused, moved, rewound to a step, or forked at a doubt." },
    { state: "next", what: "Keys a knight uses but never sees", line: "A placeholder in its script, the vault's key swapped in only at the key's own address." },
  ],
} as const;

/** 85k, 467k, 1.19M: how a footprint's length is labelled (two of the four were counted to the thousand, so no row
 * claims more precision than that). */
export function compact(lines: number): string {
  if (lines === 0) return "0";
  if (lines % 1_000_000 === 0) return `${lines / 1_000_000}M`;
  return lines >= 1_000_000 ? `${(lines / 1_000_000).toFixed(2)}M` : `${Math.round(lines / 1000)}k`;
}
