# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

- **galahad.sh** (`apps/site/`, its own project and lockfile): Astro, the owner's choice (15 Nov 2026), built to static
  files and served by Cloudflare (deployed with wrangler), with a small Worker that hands `curl` the installer.
- The product itself: a Bun/TypeScript monorepo (the node, the CLI, the PWA in `apps/web`) and a SwiftUI app for iPhone
  and iPad (`apps/apple`). Their design authority is `docs/DESIGN.md`.

## Users

Developers who self-host: engineers who want their own coding agent on machines they own. They judge it by how it
works and by installing it, so they read the mechanism, the guarantees and the numbers before they trust a claim.

## Product Purpose

Galahad is a lean agent for tasks, above all for coding and for managing large projects. He creates and orchestrates
persistent knights: named workers with lasting jobs, each working in a VM of its own on machines you own. He is one mind
across your devices, with one identity and one memory. The mandate (`docs/MANDATE.md`) is the best coding agent that has
ever existed, judged by correctness, horizon, cost and reversibility; the north star is human interventions per
completed task.

## Positioning

- **Verified, not claimed.** A task is done when its gates (commands that must pass) and an independent reviewer say
  so, never on the agent's word.
- **Yours.** It runs on your machines, with your keys, on your models; each knight works in a VM of its own.
- **Guarded by design.** Devices pair with signed keys and a 6-digit code (on iPhone the key lives in the Secure
  Enclave), every request is signed, keys are sealed in a vault and pinned to the one address each may go to, and
  anything outward or destructive asks you first (the oath gate; approve cards for the work knights propose).
- **Lean.** A codebase many times smaller than its neighbours (see Evidence), so it can be read and changed.
- **Open source**, Apache-2.0, self-hosted.

## Operating Context

- Installed with `curl -fsSL https://galahad.sh | bash` on macOS or Linux (`scripts/install.sh`), or by hand from a
  checkout (`docs/GETTING-STARTED.md`); a server with Docker and KVM runs the knights' VMs (`scripts/deploy.sh`).
- Reached from a phone over Tailscale: the PWA, and a native iPhone app (TestFlight, internal testers only for now).
- A roster of models by role (planner, engineer, reviewer, swift) with fallbacks, coding plans among them; Claude Code
  and Codex can run inside a knight's VM on the owner's own subscriptions, signed in through the vendors' own flows.
- The CLI (`galahad`), the Roundtable (knights, rooms, tasks), the archive, connectors (GitHub, Gmail, Outlook, …).

## Capabilities and Constraints

- Galahad never holds, reads or relays a subscription's sign-in (the vendors' terms); the site must not suggest he does.
- The iPhone app is not publicly downloadable yet (TestFlight, internal): the site must not offer a public download.
- Galahad runs on macOS and Linux; Windows is not supported by the installer.

## Brand Commitments

- **The knights** are ten hand-drawn knights (`apps/web/src/knights/*.webp`), used exactly as drawn: never redrawn,
  traced or generated, and on the site never recoloured (the app alone drains a paused knight's colour). Galahad is his
  own drawing with a red cross on his helm; the Black Knight is his beast mode. Their live eyes
  (`apps/web/src/lib/knight-eyes.ts`) are the only thing ever drawn over them.
- **The marks**: Galahad's helm and the Roundtable seen from above (`apps/web/src/brand.ts`, `assets/icon.svg`).
- **Colours with meaning**: Galahad's red is his seat and what needs you; ink and cream are the rest (`brand.ts`).
- **Voice**: courteous and candid (`docs/OATH.md`): say plainly what it does and what it doesn't.

## Evidence on Hand

- **Trials, 14 Nov 2026** (agentic suite, level 2, on the owner's OpenCode Go plan; `docs/TRIALS.md`): after the
  prompt-prefix fixes, Index 94 % (88–100) with 6 of 8 tasks solved outright; 73 % of input read from a cache (was 2 %);
  $0.54 and 258k tokens a task (was $1.05 and 442k); the engineer sweep: kimi-k3.1-pro 98 % at $0.30 a task,
  deepseek-v4-pro 97 % at $0.27, glm-5.3 94 % at $0.54. Approved for the site by the owner (15 Nov 2026).
- **Size, read from source on 15 Nov 2026** (`git ls-files`, test files and fixtures left out): Galahad 76,230 lines of
  TypeScript and 8,589 of Swift at `deaa43c`; Hermes Agent 720,605 of Python and 472,092 of TypeScript at its 0.21
  checkout (it has grown since); Rakazo about 467k of TypeScript; OpenMausBot about 571k of TypeScript and JavaScript.
  Comparing size with named projects was approved for the site by the owner.
- The scorecard's baselines (`bench/baseline/*.json`), and 2,180 tests in the suite (`bun run check`).
- No testimonials, customers, press or user counts exist: none may be invented.

## Product Principles

1. **Verified, not claimed**: every claim on a page links to how it was measured.
2. **Yours alone**: your machines, your keys, your models; nothing phones home.
3. **Lean and legible**: fewer moving parts, said plainly.
4. **Ask before acting outward**: the human approves what leaves or deletes.

## Accessibility & Inclusion

Nothing moves for a visitor who asks for reduced motion (the apps already hold to this); text meets WCAG AA contrast.
