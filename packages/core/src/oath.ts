/*
 * The Oath gate: every side-effecting action is classified before it runs.
 *
 *   read      look, list, fetch                                  → allow
 *   create    new bucket, prefix, branch, container, credential  → allow (logged)
 *   modify    change config, write objects, edit files           → allow (logged)
 *   outward   push, send, post, deploy, purchase                 → ask
 *   delete    remove anything persistent                         → ask
 *   forbidden breaks a hard limit                                → deny
 *
 * One exception: Galahad may clean up ephemeral things *he* created for a quest
 * (sandboxes, worktrees, temp prefixes). Everything else that deletes, asks.
 * Standing orders (signed by you) can pre-approve a narrowly matching class.
 */

export type ActionClass = "read" | "create" | "modify" | "outward" | "delete" | "forbidden";
export type Decision = { verdict: "allow" | "ask" | "deny"; reason: string };

export interface Action {
  class: ActionClass;
  /** e.g. "r2.bucket", "git.branch", "docker.container" */
  resource: string;
  /** Concrete target, e.g. "galahad-backups" or "amiriteorg/galahad#feat/x". */
  target: string;
  /** Present when the target was created by Galahad. */
  createdBy?: { quest: string; ephemeral: boolean };
  /** The quest asking, if any. */
  quest?: string;
}

export interface StandingOrder {
  id: string;
  class: Exclude<ActionClass, "forbidden">;
  resource: string;
  /** Glob over `target`, e.g. "amiriteorg/*#feat/*". */
  target: string;
  expiresAt?: number;
}

const globToRegExp = (glob: string): RegExp =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

export function decide(action: Action, orders: StandingOrder[] = [], now = Date.now()): Decision {
  switch (action.class) {
    case "forbidden":
      return { verdict: "deny", reason: "breaks a limit of the oath" };
    case "read":
    case "create":
    case "modify":
      return { verdict: "allow", reason: `${action.class} is within Galahad's freedom (logged)` };
  }

  if (
    action.class === "delete" &&
    action.createdBy?.ephemeral &&
    action.quest !== undefined &&
    action.createdBy.quest === action.quest
  ) {
    return { verdict: "allow", reason: "cleaning up an ephemeral resource this quest created" };
  }

  const order = orders.find(
    (o) =>
      o.class === action.class &&
      o.resource === action.resource &&
      globToRegExp(o.target).test(action.target) &&
      (o.expiresAt === undefined || o.expiresAt > now),
  );
  if (order) return { verdict: "allow", reason: `standing order ${order.id}` };

  return {
    verdict: "ask",
    reason: action.class === "delete" ? "deleting requires your approval" : "outward-facing actions require your approval",
  };
}
