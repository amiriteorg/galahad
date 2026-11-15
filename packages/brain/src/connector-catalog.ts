import type { ConnectorManifest } from "@galahad/core";

/*
 * Connectors that ship with Galahad. Each is only a manifest: install one with
 * `galahad connector add <id>`, put its key in the vault, and every node can use it.
 * Tools that change the world outside are classed outward or delete, so Galahad
 * asks you before each one; reading and creating are his to do (and logged).
 */

export interface CatalogEntry {
  manifest: Omit<ConnectorManifest, "origin"> & { origin?: string };
  /** The origin is yours (a Home Assistant on your LAN): give it at install. */
  needsOrigin?: boolean;
  /** Where to get a key, shown when it's missing. */
  keyHelp?: string;
}

const owner = { type: "string", pattern: "[A-Za-z0-9_.-]{1,100}", required: true } as const;
const repo = owner;
const perPage = { type: "integer", description: "results per page (max 100)" } as const;
const page = { type: "integer", description: "which page of results (from 1)" } as const;
const number = { type: "integer", required: true } as const;
const account = { type: "string", pattern: "[a-f0-9]{32}", required: true, description: "Cloudflare account id" } as const;
const bucketName = { type: "string", pattern: "[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", required: true } as const;

export const CATALOG: Record<string, CatalogEntry> = {
  github: {
    keyHelp: "a fine-grained token from https://github.com/settings/personal-access-tokens (public reads work without one)",
    manifest: {
      id: "github",
      label: "GitHub",
      description: "Repositories, issues, pull requests (their files, reviews and checks), Actions runs and notifications.",
      origin: "https://api.github.com",
      auth: { secret: "github", scheme: "bearer", optional: true },
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      tools: {
        me: { description: "Who the token belongs to.", method: "GET", path: "/user", class: "read" },
        notifications: {
          description: "Your unread notifications.",
          method: "GET",
          path: "/notifications",
          params: { all: { type: "boolean" }, participating: { type: "boolean" }, per_page: perPage },
          class: "read",
        },
        repo: { description: "A repository.", method: "GET", path: "/repos/{owner}/{repo}", params: { owner, repo }, class: "read" },
        issues: {
          description: "Issues (and pull requests) in a repository.",
          method: "GET",
          path: "/repos/{owner}/{repo}/issues",
          params: { owner, repo, state: { type: "string", enum: ["open", "closed", "all"] }, labels: { type: "string" }, per_page: perPage },
          class: "read",
        },
        issue: {
          description: "One issue or pull request.",
          method: "GET",
          path: "/repos/{owner}/{repo}/issues/{number}",
          params: { owner, repo, number: { type: "integer", required: true } },
          class: "read",
        },
        pulls: {
          description: "Pull requests in a repository.",
          method: "GET",
          path: "/repos/{owner}/{repo}/pulls",
          params: { owner, repo, state: { type: "string", enum: ["open", "closed", "all"] }, per_page: perPage },
          class: "read",
        },
        pull: {
          description: "One pull request: its head and base (with their commits), whether it can be merged, and its state.",
          method: "GET",
          path: "/repos/{owner}/{repo}/pulls/{number}",
          params: { owner, repo, number },
          class: "read",
        },
        "pull.files": {
          description: "The files a pull request changes, each with its patch.",
          method: "GET",
          path: "/repos/{owner}/{repo}/pulls/{number}/files",
          params: { owner, repo, number, per_page: perPage, page },
          class: "read",
        },
        "pull.reviews": {
          description: "The reviews of a pull request: who approved or asked for changes, and what they said.",
          method: "GET",
          path: "/repos/{owner}/{repo}/pulls/{number}/reviews",
          params: { owner, repo, number, per_page: perPage },
          class: "read",
        },
        "pull.comments": {
          description: "Review comments on a pull request's lines: the file, the line and what was said.",
          method: "GET",
          path: "/repos/{owner}/{repo}/pulls/{number}/comments",
          params: { owner, repo, number, per_page: perPage },
          class: "read",
        },
        runs: {
          description: "Recent GitHub Actions runs.",
          method: "GET",
          path: "/repos/{owner}/{repo}/actions/runs",
          params: { owner, repo, branch: { type: "string" }, status: { type: "string" }, per_page: perPage },
          class: "read",
        },
        "run.jobs": {
          description: "The jobs of an Actions run, each with its steps and how they ended: which one failed.",
          method: "GET",
          path: "/repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
          params: { owner, repo, run_id: { type: "integer", required: true }, per_page: perPage },
          class: "read",
        },
        checks: {
          description: "The checks run on a commit, a branch or a tag (CI): each one's status and conclusion.",
          method: "GET",
          path: "/repos/{owner}/{repo}/commits/{ref}/check-runs",
          params: { owner, repo, ref: { type: "string", pattern: "[A-Za-z0-9._/-]{1,200}", required: true, description: "a commit's sha, a branch or a tag" }, per_page: perPage },
          class: "read",
        },
        "check.annotations": {
          description: "What a check reported against the code: each file, line and message (where a failing test or a build error usually is).",
          method: "GET",
          path: "/repos/{owner}/{repo}/check-runs/{check_run_id}/annotations",
          params: { owner, repo, check_run_id: { type: "integer", required: true }, per_page: perPage },
          class: "read",
        },
        "branch.create": {
          description: "Create a branch at a commit (ref is refs/heads/<name>).",
          method: "POST",
          path: "/repos/{owner}/{repo}/git/refs",
          params: {
            owner,
            repo,
            ref: { type: "string", pattern: "refs/heads/[A-Za-z0-9._/-]{1,200}", required: true },
            sha: { type: "string", pattern: "[a-f0-9]{40}", required: true },
          },
          class: "create",
        },
        "issue.create": {
          description: "Open an issue. Others see it: Galahad asks first.",
          method: "POST",
          path: "/repos/{owner}/{repo}/issues",
          params: { owner, repo, title: { type: "string", required: true }, body: { type: "string" } },
          class: "outward",
        },
        "pr.create": {
          description: "Open a pull request from head into base. Others see it: Galahad asks first, unless a standing order covers it.",
          method: "POST",
          path: "/repos/{owner}/{repo}/pulls",
          params: {
            owner,
            repo,
            head: { type: "string", required: true, description: "The branch with the changes, e.g. feat/orders" },
            base: { type: "string", required: true, description: "The branch to merge into, e.g. main" },
            title: { type: "string", required: true },
            body: { type: "string" },
            draft: { type: "boolean" },
          },
          class: "outward",
        },
        ship: {
          description:
            "Ship a quest's changes: commit them on a new galahad/… branch (never an existing one) and open a pull request. Others see it: Galahad asks first, unless a standing order covers it.",
          native: "github.ship",
          method: "POST",
          path: "/repos/{owner}/{repo}/pulls",
          params: {
            owner,
            repo,
            artifact: { type: "string", pattern: "art_[A-Za-z0-9_-]{22}", required: true, description: "The kept work holding the shipment (ship/manifest.json)" },
            branch: { type: "string", pattern: "galahad/[A-Za-z0-9._-]{1,80}(/[A-Za-z0-9._-]{1,80})?", required: true, description: "A new branch for the changes, e.g. galahad/units" },
            base: { type: "string", pattern: "[A-Za-z0-9._/-]{1,200}", description: "The branch to merge into (default: the repository's default branch)" },
            title: { type: "string", required: true },
            body: { type: "string" },
            draft: { type: "boolean" },
          },
          class: "outward",
        },
        "issue.comment": {
          description: "Comment on an issue or pull request. Others see it: Galahad asks first.",
          method: "POST",
          path: "/repos/{owner}/{repo}/issues/{number}/comments",
          params: { owner, repo, number: { type: "integer", required: true }, body: { type: "string", required: true } },
          class: "outward",
        },
        // Never APPROVE: an approval is your word on your account, and branch protection counts it.
        "pull.review": {
          description: "Review a pull request: a comment, or a request for changes. Others see it: Galahad asks first. (Approving stays yours.)",
          method: "POST",
          path: "/repos/{owner}/{repo}/pulls/{number}/reviews",
          params: { owner, repo, number, event: { type: "string", enum: ["COMMENT", "REQUEST_CHANGES"], required: true }, body: { type: "string", required: true } },
          class: "outward",
        },
      },
    },
  },
  cloudflare: {
    keyHelp: "an API token from https://dash.cloudflare.com/profile/api-tokens (R2 edit for buckets)",
    manifest: {
      id: "cloudflare",
      label: "Cloudflare",
      description: "Accounts, zones, DNS records, Workers and R2 buckets. Creating buckets is free; deleting one asks.",
      origin: "https://api.cloudflare.com",
      basePath: "/client/v4",
      auth: { secret: "cloudflare", scheme: "bearer" },
      tools: {
        "token.verify": { description: "Check the API token works.", method: "GET", path: "/user/tokens/verify", class: "read" },
        accounts: { description: "Accounts the token can see.", method: "GET", path: "/accounts", class: "read" },
        zones: {
          description: "Zones (domains).",
          method: "GET",
          path: "/zones",
          params: { name: { type: "string" }, per_page: perPage },
          class: "read",
        },
        "dns.records": {
          description: "DNS records in a zone.",
          method: "GET",
          path: "/zones/{zone}/dns_records",
          params: { zone: { type: "string", pattern: "[a-f0-9]{32}", required: true }, name: { type: "string" } },
          class: "read",
        },
        workers: { description: "Workers scripts.", method: "GET", path: "/accounts/{account}/workers/scripts", params: { account }, class: "read" },
        "r2.buckets": { description: "R2 buckets.", method: "GET", path: "/accounts/{account}/r2/buckets", params: { account }, class: "read" },
        "r2.bucket.create": {
          description: "Create an R2 bucket.",
          method: "POST",
          path: "/accounts/{account}/r2/buckets",
          params: { account, name: bucketName, locationHint: { type: "string", enum: ["apac", "eeur", "enam", "weur", "wnam", "oc"] } },
          class: "create",
        },
        "r2.bucket.delete": {
          description: "Delete an empty R2 bucket. Deleting asks you first.",
          method: "DELETE",
          path: "/accounts/{account}/r2/buckets/{name}",
          params: { account, name: { ...bucketName, in: "path" } },
          class: "delete",
        },
      },
    },
  },
  "home-assistant": {
    needsOrigin: true,
    keyHelp: "a long-lived access token from your Home Assistant profile page",
    manifest: {
      id: "home-assistant",
      label: "Home Assistant",
      description: "Read your home's state. Anything that moves, heats, unlocks or opens asks you first, every time.",
      auth: { secret: "home-assistant", scheme: "bearer" },
      tools: {
        status: { description: "Is Home Assistant up?", method: "GET", path: "/api/", class: "read" },
        states: { description: "Every entity's state.", method: "GET", path: "/api/states", class: "read" },
        state: {
          description: "One entity's state.",
          method: "GET",
          path: "/api/states/{entity_id}",
          params: { entity_id: { type: "string", pattern: "[a-z_]+\\.[a-z0-9_]+", required: true } },
          class: "read",
        },
        service: {
          description: "Call a service (turn on a light, lock a door). The physical world: always asks.",
          method: "POST",
          path: "/api/services/{domain}/{service}",
          params: {
            domain: { type: "string", pattern: "[a-z_]+", required: true },
            service: { type: "string", pattern: "[a-z_]+", required: true },
            entity_id: { type: "string", pattern: "[a-z_]+\\.[a-z0-9_]+", required: true },
          },
          class: "outward",
        },
      },
    },
  },
};
