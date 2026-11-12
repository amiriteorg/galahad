# AGENTS.md

These are instructions for any coding agent working on this repo, Galahad himself included. They're good defaults, and the owner's explicit preferences override them.

## Commands

```sh
bun install
bun run check                          # tsc + full test suite; must be green before you say "done"
GALAHAD_KEYSTORE=file bun test         # tests never touch the OS keychain
bun test packages/mind                 # one package
bun galahad help                       # the CLI
bun run bench                          # the scorecard: every benchmark suite against its baseline (a few minutes)
bun run bench fleet compute            # some suites; --full the long sizes; --all every metric; --ci what CI gates on
```

A change that should make something better (or might make something worse) is shown with the scorecard: run it before and after. A quality metric that got worse fails the run; record a new baseline only on purpose (`--update-baseline`), in its own reviewed change, and say why. How to read it and how to add a metric: [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Layout

| Path | Owns |
|---|---|
| `packages/core` | **Contracts** (API routes + scopes, event schemas), crypto, canonical JSON, HLC, pairing math, request signing, oath gate, secret scanning |
| `packages/mind` | The replica (log + views), the vault, fleet enrollment and revocation |
| `packages/link` | Pairing host, the joining client, sync |
| `packages/brain` | Providers, roster, adapters, chat with fallback, the model gateway |
| `packages/node` | Daemon, HTTP server, CLI, capabilities, placement, the archive (`src/archive/`) |
| `apps/web` | The PWA (bundled by the daemon at start) |
| `bench/` | The scorecard: the runner, the suites, their simulations, the recorded baselines (`bench/baseline/`) |
| `docs/` | Architecture, oath, trials, doctrine |

## Rules

- **Contracts live in `packages/core`.** Validate every input at the boundary with zod. Each route declares exactly one scope.
- **Never weaken crypto or auth checks** to make a test pass. Fix the code or the test's setup instead.
- **No secrets** in logs, chat, memory, fixtures or commits. Test keys must be obviously fake.
- **Failing test first** for every bug. **Flaky tests are fixed at the cause, never retried.**
- **Convergence is sacred:** the property tests (any order → same digest; rebuild → same state) must stay green. A new event kind must be deterministic under replay and must keep unknown kinds forward-compatible.
- **YAGNI.** Don't introduce machinery because it looks impressive. Complexity belongs at adapter boundaries; orchestration stays pure and transports stay thin.
- **Hit every surface:** when you change a contract, update the server, the CLI, the PWA and the docs.
- **Don't run destructive commands** (no `rm -rf` outside temp dirs, no killing by pattern, no force-push). Tests use temp homes, never `~/.galahad`.
- Default branch is `main`. Commit or open PRs only when asked.
