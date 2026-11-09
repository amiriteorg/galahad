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

## Known limitations

**#5: same-user agents.** On a desktop, the daemon and your coding agents (Claude Code and others) run as the same OS user. An agent with shell access can read the admin token and, with the file keystore, the device keys. Arm tokens limit what an agent can do *through Galahad*. They can't stop a same-user process from reading files that user owns.
- On sandbox hosts (ultra), the daemon runs as the dedicated `galahad` user, and its home directory isn't readable by other users.
- **Planned:** run the desktop daemon as its own user as well, and move the admin credential behind the OS keychain with confirmation on each use.
- Until then, give agents shell access only on machines where you accept this.

**#6: Docker is root-equivalent.** The `galahad` user is in the `docker` group so that it can run sandboxes. Docker access amounts to root on that host, so the hardened systemd unit doesn't make a listener bug harmless there.
- **Planned:** rootless Docker, or a small privileged helper that can only run the fixed, hardened `docker run` arguments.

## Reporting

This is a private project. Tell Galahad's owner directly, or open an issue in the repository.
