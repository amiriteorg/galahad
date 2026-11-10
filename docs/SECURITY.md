# Security

Galahad is an autonomous agent with access to every machine you own, so its security is part of its design. This page records what it defends against, what an independent review found, and the limits that remain. Tested claims are marked as tested.

## Threat model, in one breath

**Defended against:**
- a stolen or lost device
- a stolen node key
- a prompt-injected agent (arm)
- hostile content in web pages, files and messages
- a compromised sandbox
- a malicious peer on your tailnet
- network partitions, clock skew, and duplicated or reordered delivery

**Out of scope:**
- an attacker who is already root on a full node, which holds the vault by design
- your Tailscale control plane being compromised, which is mitigated, not eliminated, by device-key signatures on every request

## Independent review (November 2026)

A fresh agent, given only the code and the claims above, audited the whole repository and reported 13 findings. Each fix has a test that fails without it.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | A revoked node's stolen key could backdate events, for example enrolling a device of its own | **Fixed.** Events are hash-chained per device, and revocation pins the chain head. Equivocation (a device forking its own chain) is detected everywhere. `chain.test.ts` |
| 2 | High | A client with `brain:write` could repoint a provider and have a key sent to its own host. Paired clients also got every scope | **Fixed.** Keys are pinned to the origin they were entered for, and only for their own provider. Phones can't approve new machines. Client invites default to least privilege. Tested in e2e |
| 3 | Medium | A far-future HLC counter could wedge writes fleet-wide | **Fixed.** The counter carries into milliseconds, and only accepted events from known signers move the clock |
| 4 | Medium | A device's events delivered to only some replicas could fork the mind | **Fixed.** Sync compares per-device digests, and holes below the frontier are filled |
| 5 | Medium | An agent with a shell, running as the same OS user, can read `~/.galahad/admin.token` | **Limitation, see below** |
| 6 | Medium | `docker` group membership makes the sandbox host's node root-equivalent | **Limitation, see below** |
| 7 | Low–Medium | Arms could forget your memories | **Fixed.** An arm may forget only what it wrote |
| 8 | Low–Medium | Events from unknown keys grew every log forever | **Fixed.** They're parked (capped, never relayed) and promoted only on enrollment |
| 9 | Low | Request bodies were unbounded before auth | **Fixed.** 8 MB cap on every listener |
| 10 | Low | Sandbox isolation depended on UFW being active | **Fixed.** A `galahad-firewall` unit owns the rules: only 7779/tcp on `galahad0` |
| 11 | Low | A repeated pairing request with different keys kept the first one | **Fixed.** Any change locks the invite |
| 12 | Low | A crafted image's labels could get an arbitrary gateway token revoked | **Fixed.** Token hashes live in node-local state |
| 13 | Low | Assistant-role chat messages weren't secret-scanned | **Fixed.** Every message is scanned |

The review also confirmed what held up:
- domain-separated Ed25519 event signatures
- request signing over method, path, time, nonce and body hash, with replay protection
- the listener boundaries (loopback, proxied, tailnet and sandbox)
- the vault: random 24-byte nonces, AAD bound to fleet, name and kid, grants only to full nodes
- the gateway: per-provider scope, atomic budgets, header allowlist, redaction
- the pairing proofs and SAS
- forwarding (it never re-forwards and never accepts an injected approval)
- the sandbox's Docker flags
- the PWA's DOM-only rendering

## Loops, connectors and approvals (tested)

- **Connector keys go where you said, only.** A key is injected only if it was pinned to the connector's origin and entered for that connector; redirects are never followed; answers are capped and redacted; arguments that look like keys are refused; hostile arguments can't leave their path segment or the origin (`packages/core/test/connectors.test.ts`, `packages/brain/test/connectors.test.ts`).
- **Manifests are data.** No connector code runs; a manifest can't set credentials, cookies or `Host`, and its HTTP method bounds the oath class it may claim. Installing one needs `brain:write`, which arms never hold.
- **Only you approve.** Action decisions are accepted only from your terminal or a paired device, never from a node or an agent; the first decision stands on every replica; only the requesting node sends, at most once, even across a crash (`packages/mind/test/loops.test.ts`, `packages/node/test/connectors.e2e.test.ts`).
- **Loops act as Galahad, not as you.** A loop's quest runs on a short-lived arm token and its connector calls are an agent's calls, so outward actions ask.
- **Standing orders stay narrow, and the log proves them.** Only you sign one (an arm's attempt is refused by scope); it covers one tool that would ask, names where the call goes, pins deletes exactly, expires within a year and stops applying if the tool changes. Every replica re-checks on replay that the order covered the exact call when it was applied, so a node can't record an order-approval the order doesn't support (`packages/core/test/orders.test.ts`, `packages/mind/test/loops.test.ts`, `packages/node/test/connectors.e2e.test.ts`).
- **Remote MCP servers get the same fences.** Same origin pinning, no redirects, capped and redacted answers, keys only as pinned, no keys in URLs. Tools are listed once and stored, their classes are yours (the server's hints only propose one: no hint means it asks), and the client offers the server no capabilities (no sampling, roots or prompts). Tested against a real MCP server (`packages/node/test/mcp-connectors.e2e.test.ts`).
- **Residual risk:** a read tool's query string reaches the connector's own service, so an injected agent could leak data *to that service* (never elsewhere); and answers from services are untrusted data that reach agents. An MCP server decides what its tools really do: a tool you class as read that actually acts is the server's lie, so install servers you trust and keep the default (outward) for anything unclear.

## Sandbox disk limits (tested)

- **Each workspace is its own disk.** `/work` is a fixed-size ext4 image (default 20 GB), mounted `nodev,nosuid`, so a runaway job stops at its own limit. Tested on ultra: a 1 GB workspace filled with `dd` stops at "No space left on device", and the host is untouched (`packages/sandbox/test/docker.integration.test.ts`).
- **The one privileged step is tiny.** The node never gets root. A root helper (`sandbox/galahad-workspace`), started by systemd per connection on a socket only the galahad user may open, accepts four commands, takes only a 10-hex-digit id and a size, and builds every path itself under a root-only directory. The client refuses anything else before it's sent (`packages/sandbox/test/workspaces.test.ts`).
- **The host keeps a reserve.** A sandbox is created only if every workspace could fill up to its limit and 10 % of the disk (at least 20 GB) stays free.
- Found by Galahad himself, in a live quest run as a loop, in November 2026.

## Artifacts (tested)

- **What leaves a sandbox is parsed as hostile.** The node streams `docker cp` through its own tar parser: only regular files and directories are written; symlinks, hard links, devices and FIFOs are refused; paths can't climb out or be absolute; bytes and file count are capped mid-stream, so an archive can't fill the disk before a check. Tested with hand-built hostile archives (`packages/sandbox/test/tar.test.ts`), and on ultra against a real container and a real microVM that plant a link to `/etc/passwd` (`packages/sandbox/test/docker.integration.test.ts`).
- **Serving is fenced.** Only files the manifest lists are opened; HTML and SVG are served as text, never rendered; responses carry `CSP: sandbox` and `nosniff`; downloads are checked against the SHA-256 recorded in the mind (`packages/node/test/artifacts.test.ts`).
- **Agents keep, you delete.** An arm or a loop can keep only its own sandboxes' work; removing kept work needs `fleet:admin`.

## MicroVM sandboxes (tested)

- **A kernel of its own.** On a host with KVM, an `online` sandbox runs inside its own Kata microVM by default, so a container escape or kernel exploit lands in a throwaway VM, not on the host. Tested on ultra: the guest runs its own kernel, as uid 1000 with no capabilities, a read-only root, Docker's seccomp filter enforced in the guest, the disk limit holding through the VM, the internet and the model gateway reachable, and the host not (`packages/sandbox/test/docker.integration.test.ts`).
- **A smaller, unprivileged hypervisor.** QEMU runs under its own seccomp sandbox and as an unprivileged random user (Kata's `rootless`). The installer refuses to enable microVMs at all if those settings can't be applied.
- **A pinned supply chain.** Kata is a fixed release, verified against the SHA-256 GitHub records for it, and installed without touching Docker's configuration.
- **Residual risk:** gateway and isolated sandboxes stay containers unless you ask (`--vm`), because they run model-written code with no internet; Docker group membership is still root-equivalent on the host (#6 below).

## Coding agents (tested)

- **Keys stay out.** OpenCode in a sandbox reaches models only through the gateway, on a token scoped to one provider that dies with the sandbox; the provider key never enters the sandbox. Its config is written by Galahad and holds only `{env:…}` references.
- **The sandbox is the boundary.** The agent may use every tool it has (it runs non-interactively), because the sandbox decides what's reachable: models only by default (`--net gateway`), the internet only with `--net online` (then a microVM where the host has KVM). Its working state lives in the sandbox's `/work` and goes with it.
- **Pinned.** The OpenCode binary is a fixed release, verified against its SHA-256 at image build; self-updates are disabled.
- **Watched and bounded.** Every command and edit it makes is followed from its event stream and shown; past its time budget, or when you stop the quest, its whole process group is killed; an independent reviewer judges the result from the sandbox, not from the agent's account.
- **Residual risk:** inside the sandbox the agent can do anything the sandbox user can; what it writes is untrusted, like all model output, and a patch is only a proposal until you apply it.

## Shipping (tested)

- **Reading without a key.** The git gateway serves one repository per token (minted for the quest, revoked when it ends), fetch only: `git-receive-pack` is refused on every path, a token for another repository or a model token is refused, and the key is added by the node only for `github.com`, the host fixed in code for GitHub connectors (`packages/node/test/git-gateway.test.ts`).

- **No key in the sandbox, no push from it.** A quest's changes leave the sandbox as kept files (hashed, through the hostile-archive extractor); the node turns them into a commit with GitHub's API, using the connector's key on its pinned origin. Tested end to end against a stand-in GitHub: nothing is sent before approval, the key goes only to `api.github.com`, an approval ships exactly once (`packages/node/test/ship.test.ts`).
- **One approval, one shipment.** `github.ship` is outward: an agent's request waits for you (or a standing order you signed, which must name the owner and repository). Branch names are pinned to `galahad/…`; an existing branch is refused, never force-pushed; a shipment whose clone came from another repository is refused.
- **What you approved is what leaves.** Each file is checked against the SHA-256 recorded when the work was kept; a file changed on disk since stops the shipment. Paths that climb out, absolute paths and anything under `.git/` are refused.
- **Residual risk:** a pull request is public to whoever can see the repository, and what's in it is model-written: read `changes.patch` (Inbox → **Read the changes**) before you approve. Merging stays yours.

## Web search (tested)

- **Loopback only.** SearXNG listens on `127.0.0.1:8888` of the sandbox host, with every capability dropped but the three its entrypoint needs and `no-new-privileges`; it's reached through the node, never directly from a sandbox.
- **Scoped.** A sandbox searches through its gateway only with a token that carries the `search` scope; a model token or a git token is refused (`packages/node/test/search.test.ts`). Every search is ledgered.
- **Residual risk:** search results and the pages behind them are written by strangers and can carry prompt injection; quests treat them as data, and anything outward still asks you.

## Bank access (tested)

- **Read-only by construction.** The Enable Banking client knows 7 method and path pairs and none of them is a payment; the authorisation asks only for `valid_until`. Agents get four typed tools (an account uid and dates, nothing like a path), only once you grant them `bank:read`. Authorising, disconnecting and granting need `fleet:admin`, which agents can never hold (`packages/node/test/bank.test.ts`, `mcp.test.ts`).
- **Your key stays yours.** It's a 600 file of the node's user, read only to sign; anything looser, or another owner, keeps bank access off. The session id never leaves the node; errors carry a status and a code, never the bank's body; the audit log has no amounts, names, IBANs or codes.
- **The callback is checked.** 256-bit state kept as a hash, compared in constant time, single use, 15 minutes; the code leaves the address bar at once.
- **Bank text is data.** Merchant names, remittance lines and notes come back cleaned, cut to 200 characters and wrapped as `untrusted_data`, with a test that an injection comes through inert.
- **Residual risk:** whoever is root or the node's user on that node can read the key and the session. Details and the full table: [BANK](BANK.md#threat-model).

## Known limitations

**Sandbox disk without the helper.** A sandbox host deployed without `--sudo` has no workspace helper, so its sandboxes' workspaces are unlimited Docker volumes. The heartbeat raises a warning on that host until the helper is installed.

**#5: same-user agents.** On a desktop, the daemon and your coding agents (Claude Code and others) run as the same OS user. An agent with shell access can read the admin token and, with the file keystore, the device keys. Arm tokens limit what an agent can do *through Galahad*. They can't stop a same-user process from reading files that user owns.
- On sandbox hosts (ultra), the daemon runs as the dedicated `galahad` user, and its home directory isn't readable by other users.
- **Planned:** run the desktop daemon as its own user as well, and move the admin credential behind the OS keychain with confirmation on each use.
- Until then, give agents shell access only on machines where you accept this.

**#6: Docker is root-equivalent.** The `galahad` user is in the `docker` group so that it can run sandboxes. Docker access amounts to root on that host, so the hardened systemd unit doesn't make a listener bug harmless there.
- **Planned:** rootless Docker, or a small privileged helper that can only run the fixed, hardened `docker run` arguments.

## Reporting

This is a private project. Tell Galahad's owner directly, or open an issue in the repository.
