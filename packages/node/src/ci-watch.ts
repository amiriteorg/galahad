import type { Database } from "bun:sqlite";
import { type ActionView, findSecrets, type NodeIdentity } from "@galahad/core";
import type { MindStore } from "@galahad/mind";

/*
 * After you ship, the node that shipped follows the pull request's checks (CI). A ship you approved names the
 * repository and its new branch, and its receipt the pull request. For a day the node reads the branch's check runs
 * every few minutes (github.checks: a read, logged like any other, never asked about). Once every check has ended:
 *   all passed: nothing to tell, and a failure it told you about is cleared (a later push fixed it); it stops looking;
 *   one failed: a notice in your Inbox names the pull request and each failing check, with what each reported
 *     against the code (github.check.annotations: the file, the line, the message), for you or a knight to fix;
 *     where the work was a knight's, it may go back to that knight, and the notice says whether (ci-back.ts).
 * A fix pushed onto the branch keeps it followed, under the same notice. It writes nothing to GitHub and sends
 * nothing anywhere. What CI printed is someone else's text: it is shown as data, bounded, and a line that looks
 * like a key is left out.
 */

export const CI_WATCH_EVERY_MS = 3 * 60_000;
/** How long after its ship a pull request is followed. */
export const CI_WATCH_FOR_MS = 24 * 3600 * 1000;
/** A branch with no check this long after its ship has no CI to follow. */
export const CI_NO_CHECKS_MS = 20 * 60_000;
/** How a check run ends in failure. (Cancelled is not one: a newer run usually took its place.) */
const FAILED = new Set(["failure", "timed_out", "action_required", "startup_failure"]);
/** At most this many failing checks have their annotations read, and this many lines shown. */
const ANNOTATED = 3;
const LINES = 6;

export interface ShippedPull {
  /** The approved ship (an action id): the branch's first. */
  action: string;
  /** The GitHub connector it went through (github, or github-<owner>). */
  connector: string;
  owner: string;
  repo: string;
  branch: string;
  /** The work it shipped (an artifact's id). */
  artifact: string;
  /** Its pull request's number, from the ship's receipt. */
  pr: number | null;
  /** When it was shipped, or a fix last pushed onto it. */
  at: number;
}

/**
 * The pull requests this node shipped: each approved ship that went through, with its repository, branch and number.
 * One branch is one pull request: its first ship names it, and a fix pushed onto it since (ship.update) keeps it followed from then.
 */
export function shippedPulls(actions: ActionView[], node: string, doneAt: (action: string) => number | null): ShippedPull[] {
  const ships = actions.flatMap((action) => {
    if (!/^github(-[a-z0-9-]+)?$/.test(action.connector) || (action.tool !== "ship" && action.tool !== "ship.update") || action.state !== "done" || action.node !== node) return [];
    const { owner, repo, branch, artifact } = action.args as { owner?: unknown; repo?: unknown; branch?: unknown; artifact?: unknown };
    const at = doneAt(action.id);
    if (typeof owner !== "string" || typeof repo !== "string" || typeof branch !== "string" || typeof artifact !== "string" || at === null) return [];
    const pr = Number(/pull request #(\d+)/.exec(action.receipt ?? "")?.[1]) || null;
    return [{ action: action.id, connector: action.connector, owner, repo, branch, artifact, pr, at }];
  });
  const pulls = new Map<string, ShippedPull>();
  for (const ship of ships.sort((a, b) => a.at - b.at)) {
    const key = `${ship.owner.toLowerCase()}/${ship.repo.toLowerCase()}/${ship.branch}`;
    const first = pulls.get(key);
    pulls.set(key, first ? { ...first, at: ship.at, pr: first.pr ?? ship.pr } : ship);
  }
  return [...pulls.values()];
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  /** The commit it ran on. */
  head?: string;
}

/** A pull request's failure as the notice says it: the commit, the failing checks, and what they reported (as data). */
export interface CiFailure {
  head: string;
  failing: string[];
  lines: string[];
}

export type CiVerdict = { state: "running" } | { state: "none" } | { state: "passed"; total: number } | { state: "failed"; total: number; failing: CheckRun[] };

/** Where a branch's checks stand: still running, none at all (after a while), all passed, or some failed. */
export function ciVerdict(runs: CheckRun[], sinceShipMs: number): CiVerdict {
  if (!runs.length) return sinceShipMs >= CI_NO_CHECKS_MS ? { state: "none" } : { state: "running" };
  if (runs.some((run) => run.status !== "completed")) return { state: "running" };
  const failing = runs.filter((run) => run.conclusion !== null && FAILED.has(run.conclusion));
  return failing.length ? { state: "failed", total: runs.length, failing } : { state: "passed", total: runs.length };
}

export interface CiWatchOptions {
  store: MindStore;
  identity: NodeIdentity;
  local: Database;
  /** The pull requests to follow (shippedPulls over the outbox). */
  shipped: () => ShippedPull[];
  /** One GitHub read through the connector the pull request was shipped by (<connector>.<tool>), as the node's own. */
  call: (tool: "checks" | "check.annotations", args: Record<string, string | number>, connector: string) => Promise<{ ok: boolean; status: number; body: string }>;
  /** Whether its failure goes back to the knight whose work it was: what the notice says of that (ci-back.ts), or nothing. */
  back?: (pull: ShippedPull, failure: CiFailure) => string | null;
  now?: () => number;
  log: (message: string) => void;
}

export class CiWatch {
  private timer: ReturnType<typeof setInterval> | null = null;
  private looking: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(private readonly o: CiWatchOptions) {
    this.now = o.now ?? Date.now;
    o.local.exec("CREATE TABLE IF NOT EXISTS ci_watch (action TEXT PRIMARY KEY, state TEXT NOT NULL, at INTEGER NOT NULL)");
  }

  start(everyMs = CI_WATCH_EVERY_MS): void {
    this.stopTimer();
    this.timer = setInterval(() => void this.tick(), everyMs);
  }

  async stop(): Promise<void> {
    this.stopTimer();
    await this.looking;
  }

  /** One look at every pull request still followed (a look under way is joined, not doubled). */
  tick(): Promise<void> {
    this.looking ??= this.look().finally(() => (this.looking = null));
    return this.looking;
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async look(): Promise<void> {
    const now = this.now();
    for (const pull of this.o.shipped()) {
      if (now - pull.at >= CI_WATCH_FOR_MS) continue;
      const seen = this.o.local.query<{ state: string }, [string]>("SELECT state FROM ci_watch WHERE action = ?").get(pull.action)?.state;
      if (seen === "passed" || seen === "none" || seen === "unreadable") continue;
      try {
        const verdict = ciVerdict(await this.checks(pull), now - pull.at);
        if (verdict.state === "running") continue;
        if (verdict.state === "failed") await this.tell(pull, verdict.total, verdict.failing);
        else this.clear(pull);
        this.o.local.query("INSERT INTO ci_watch (action, state, at) VALUES (?, ?, ?) ON CONFLICT (action) DO UPDATE SET state = excluded.state, at = excluded.at").run(pull.action, verdict.state, now);
      } catch (error) {
        const message = (error as Error).message;
        this.o.log(`ci: ${pull.owner}/${pull.repo} ${pull.branch}: ${message}`);
        // A GitHub connector installed before it could read checks: said once, not every few minutes for a day.
        if (/has no tool "checks"/.test(message)) {
          this.o.log("ci: the GitHub connector can't read checks yet; add it again to have shipped pull requests followed (galahad connector add github)");
          this.o.local.query("INSERT OR REPLACE INTO ci_watch (action, state, at) VALUES (?, 'unreadable', ?)").run(pull.action, now);
        }
      }
    }
  }

  private async checks(pull: ShippedPull): Promise<CheckRun[]> {
    const result = await this.o.call("checks", { owner: pull.owner, repo: pull.repo, ref: pull.branch, per_page: 100 }, pull.connector);
    if (!result.ok) throw new Error(`GitHub answered ${result.status}`);
    const runs = (JSON.parse(result.body) as { check_runs?: unknown[] }).check_runs ?? [];
    return runs.flatMap((raw) => {
      const r = raw as { id?: unknown; name?: unknown; status?: unknown; conclusion?: unknown; head_sha?: unknown };
      if (typeof r.id !== "number" || typeof r.name !== "string" || typeof r.status !== "string") return [];
      return [{ id: r.id, name: r.name, status: r.status, conclusion: typeof r.conclusion === "string" ? r.conclusion : null, ...(typeof r.head_sha === "string" && /^[0-9a-f]{40}$/.test(r.head_sha) ? { head: r.head_sha } : {}) }];
    });
  }

  /** What the failing checks reported against the code: "path:line message", one line each. */
  private async annotations(pull: ShippedPull, failing: CheckRun[]): Promise<string[]> {
    const lines: string[] = [];
    for (const run of failing.slice(0, ANNOTATED)) {
      const result = await this.o.call("check.annotations", { owner: pull.owner, repo: pull.repo, check_run_id: run.id, per_page: LINES }, pull.connector);
      if (!result.ok) continue;
      for (const raw of JSON.parse(result.body) as unknown[]) {
        const a = raw as { path?: unknown; start_line?: unknown; message?: unknown };
        if (typeof a.path !== "string" || typeof a.message !== "string") continue;
        const line = `${a.path}${typeof a.start_line === "number" ? `:${a.start_line}` : ""} ${a.message.split("\n")[0]!.trim()}`.slice(0, 200);
        lines.push(findSecrets(line).length ? "(a line that looked like a key was left out)" : line);
      }
    }
    return lines.slice(0, LINES);
  }

  private async tell(pull: ShippedPull, total: number, failing: CheckRun[]): Promise<void> {
    const key = `ci:${pull.action}`;
    const title = `CI failed on ${pull.owner}/${pull.repo}${pull.pr ? `#${pull.pr}` : ` (${pull.branch})`}`;
    const names = failing.map((run) => run.name);
    const lines = await this.annotations(pull, failing);
    // (What became of it comes before what CI said, so a long report never cuts it off.)
    const head = failing.find((run) => run.head)?.head;
    let back: string | null = null;
    try {
      if (head) back = this.o.back?.(pull, { head, failing: names, lines }) ?? null;
    } catch (error) {
      this.o.log(`ci: ${pull.owner}/${pull.repo} ${pull.branch}: not given back (${(error as Error).message})`);
    }
    const body = [`${failing.length} of ${total} checks failed: ${names.join(", ")}.`, ...(back ? [back] : []), ...lines].join("\n").slice(0, 600);
    const current = this.o.store.lww<{ title: string; body: string; severity: string } | null>(`notice:${key}`)?.value;
    if (current && current.title === title && current.body === body && current.severity === "warn") return;
    this.o.store.emit(this.o.identity, "notice.raised", { key, severity: "warn", title, body, source: "ci", at: this.now() });
  }

  private clear(pull: ShippedPull): void {
    const key = `ci:${pull.action}`;
    if (this.o.store.lww(`notice:${key}`)?.value) this.o.store.emit(this.o.identity, "notice.cleared", { key });
  }
}
