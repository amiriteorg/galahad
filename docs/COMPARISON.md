# How Galahad compares

Galahad next to five agents people use for the same work, surface by surface: where each one runs, how its work is kept apart and checked, and how you reach it from a browser, a desktop and a phone. Read on **16 November 2026** from each project's own releases, documentation and App Store listings; every fact has its source below. On **18 November** three more were read the same way (T3 Code, Orchestrator.inc and OpenHands, in [their own section](#three-more-18-november)), and the five's releases since. Products change quickly (Rakazo shipped seven releases between 3 and 12 November), so this page says when it was true, and is redone rather than guessed at.

| | Version on 16 Nov | Licence |
|---|---|---|
| **Galahad** | `main` | Apache-2.0 |
| **Hermes Agent** (Nous Research) | 0.23.1, 9 Nov [H2]; 0.23.2 on 16 Nov [H14] | MIT [H13] |
| **Rakazo** (elie222) | 0.11.0, 12 Nov [R1]; 0.12.0 on 16 Nov [R14] | Apache-2.0 [R13] |
| **OpenMausBot** | 0.1.161, 15 Nov [M1]; 0.1.169 on 17 Nov [M11] | Apache-2.0, with a source-available `enterprise/` part [M2] |
| **Grok Bot** (xAI, on Cursor) | hosted; iOS app 1.26.0, 14 Nov [G2] | closed |
| **Dots** (OpenAI, in ChatGPT) | hosted, since 29 Sep [D9] | closed |

## The node: where the work runs

| | Runs on | What keeps an agent's work apart | Work running when it restarts |
|---|---|---|---|
| **Galahad** | Your machines only (macOS or Linux; knights' VMs on Linux with KVM, or on a Mac through Apple's `container`) | A microVM per knight (Kata's on Linux, Apple's on a Mac, behind a firewall of its own), with its own kernel, disk and gateway token | Taken up again once after a planned restart, its gates and reviewer deciding as ever |
| **Hermes Agent** | Your machine or server, or Hermes Cloud [H1][H10] | The host by default: "the only security boundary… is the operating system" [H4]; Docker, SSH, Modal or Daytona optional | A policy for missed scheduled runs only [H1] |
| **Rakazo** | Self-hosted with Docker Compose, or hosted [R2] | A Docker computer per bot, or e2b, Daytona and others; since 0.11 a firewalled VM per bot on Apple-silicon Macs [R1][R2] | Leased runs, resumed by the process that replaces it [R3] |
| **OpenMausBot** | Your machine, a VPS, or its paid cloud [M3][M6] | Every bot starts at Full access [M5]; its "Local VM" is a Docker or Podman container [M4] | A running turn is run again once, unless it already acted outward [M9] |
| **Grok Bot** | Cursor's cloud only, in the US [G4] | One Firecracker microVM per user, shared by all of that user's bots [G3] | Paused at a safe point and resumed on the new computer [G6] |
| **Dots** | OpenAI's cloud [D1] | A computer per dot; OpenAI: the task boundary is "not an isolation guarantee" [D4] | Not documented |

## Checking the work

| | When a task counts as done | Published benchmark numbers |
|---|---|---|
| **Galahad** | Its gates (commands that must pass, tried before the work and after) pass, then an independent reviewer accepts the diff | Its own trials, with every run's record ([TRIALS](TRIALS.md)) |
| **Hermes Agent** | Code-review and TDD skills exist as prompts; no enforced gate or reviewer found [H11] | None found |
| **Rakazo** | No enforced gate found; its evals test Rakazo itself [R9] | None published [R9] |
| **OpenMausBot** | No gate or reviewer found | None found |
| **Grok Bot** | An Auto Review model screens risky actions [G4]; coding goes to Cursor Cloud Agents [G12] | None found |
| **Dots** | Auto-review of risky actions [D4]; coding in a Codex cloud environment [D3] | None found |

Galahad declined a model screening risky actions on purpose: what needs you stays decided by the [oath](OATH.md)'s classes and your word, never by a model's score ([PLAN](PLAN.md#declined-and-why)).

## Clients

| | Web | Desktop | iPhone | Android | How a client is let in |
|---|---|---|---|---|---|
| **Galahad** | The full app, an installable PWA from your node | A Mac app (macOS 27): client and node in one, notarized and self-updating; elsewhere the PWA, installed | Native (SwiftUI), in testing on TestFlight | Native (Kotlin, Jetpack Compose): a 2.6 MB signed APK on GitHub's releases; or the PWA | An invite and a six-digit code on both screens; the device's key never leaves it (Secure Enclave on iPhone, the Keystore's secure hardware on Android); every request signed, each route its own scope |
| **Hermes Agent** | A Webapp, off by default, no PWA found [H1][H6] | Electron: macOS and Windows [H1][H3] | None official | The CLI under Termux; a third-party app over the LAN in plain HTTP [H8][H9] | A one-use link locally; remotely a Nous account or a password gate behind a tunnel; plain HTTP on the LAN [H6] |
| **Rakazo** | A web app with a service worker [R2][R8] | Electron: macOS, Windows, Linux [R6] | App Store (Expo) [R7] | Google Play and an APK [R5][R11] | A rakazo.com account, or your server's HTTPS address [R5] |
| **OpenMausBot** | A phone web app [M10] | macOS, Windows, Ubuntu (beta) [M3] | App Store [M7] | Google Play named in its docs (unconfirmed) [M6] | QR pairing, trust kept per device in the Keychain, revocable; a relay, Tailscale or the LAN [M6][M1] |
| **Grok Bot** | None; X Chat reaches the bots [G7] | macOS, Windows, Linux [G8] | App Store [G9] | Google Play [G9] | A Cursor account, with SSO [G4] |
| **Dots** | ChatGPT in a desktop browser; not on mobile web [D2] | The ChatGPT desktop app [D2] | The ChatGPT app [D6] | The ChatGPT app [D6] | A ChatGPT account [D2] |

## Reach

| | Chat apps | What starts work besides you |
|---|---|---|
| **Galahad** | Telegram (18 November) and Slack (20 November): a bot or an app of yours answering only your linked account, as a revocable device that may chat; Slack over Socket Mode, so nothing is opened ([PLAN #19](PLAN.md)) | Schedules (loops), the heartbeat, a pull request's CI after a ship, and since 18 November events: a signed webhook, new Gmail or Outlook mail, a GitHub repository's failed CI run, push, new issue or new pull request ([PLAN #13](PLAN.md)) |
| **Hermes Agent** | About 30 adapters: Telegram, Slack, Discord, WhatsApp, Signal, iMessage, Teams, Matrix, email and more [H7] | Schedules |
| **Rakazo** | Teams, Slack, Telegram, iMessage/SMS, WhatsApp, Feishu [R4][R1] | Routines, and since 0.11 a page that changes [R1] |
| **OpenMausBot** | Slack, through its cloud only [M8] | Automations [M1] |
| **Grok Bot** | Slack, Teams, X Chat, @bot on X [G7][G8][G10] | Slack, email and GitHub events [G11] |
| **Dots** | Slack, Teams, calls, iMessage/RCS texting (beta) [D2] | The Slack channels and events you name [D1] |

## Three more, 18 November

| | Version, licence | Where the work runs, and how it's kept apart | Checking the work | Clients | Reach |
|---|---|---|---|---|---|
| **T3 Code** (pingdotgg) | 0.1.10, 17 Nov; MIT [T1][T2] | It drives the coding tools you're signed in to (Claude Code, Codex, Cursor, OpenCode, Grok Build and any ACP agent, about eleven) on your machine, a worktree per thread; the default permission is Full access on the host [T1][T5] | None enforced; its "Auto" approval is the provider's own model review [T5]. A watched pull request wakes the agent on failed checks, comments and conflicts [T7] | Desktop on macOS, Windows and Linux; web; App Store and Google Play [T1] | An MCP server for outside agents, with OAuth [T6]; a scheduler; no chat apps |
| **Orchestrator.inc** | 0.15.3, 16 Nov; Apache-2.0 [A1][A2] | An orchestrator agent plans and starts a worker per piece, each in a worktree of its own on your machine (worktrees only) [A1][A4] | An optional reviewer agent; a failed CI run, review comments and conflicts go back to the worker that owns the branch, on by default [A1][A3] | Desktop on macOS, Windows and Linux; iPhone and Android apps [A1] | Approvals on the phone; no chat apps found |
| **OpenHands** (Agent Canvas) | 1.41.0, 16 Nov; MIT [O1][O2] | OpenHands, Claude Code, Codex, Gemini or any ACP agent on your machine, Docker, a VM or a cloud; its first quickstart runs with full access to your files [O1] | Hooks; none enforced. It publishes the OpenHands Index, five public benchmarks [O3] | A web app (Electron) [O1] | Automations on a schedule or webhooks: Slack, GitHub, Linear [O1] |

Since 16 November, among the five: Rakazo 0.12 can hand coding work to a T3 Code environment over MCP and stops a loop whose tool keeps returning the same result [R14]; OpenMausBot's new bots on a Mac or Windows work on "This computer" by default (0.1.165) and it caps spend per day and month [M11]; Hermes Agent's subagents survive a restart [H14]; Dots is on by default for eligible Enterprise, Edu and Healthcare workspaces from 18 November and can reach a local computer while the ChatGPT app is open [D10][D11]. Nothing new from Grok Bot was confirmed.

## Since 18 November, read 19 November

**Rakazo 0.13.0** (18 November) [R15]: approval settings now cover routines, chat apps and work influenced by outside content, its Auto Review (a model) weighs the owner's recent instructions, and unattended approvals expire after 30 minutes; a plain-text Gmail or Slack draft is edited on its approval card before it is sent; a connected MCP server can ask a question or for a confirmation in chat; meeting bots join calls and return speaker-labelled transcripts; routines run from webhooks, Git events, chat messages and email; outside guests join one Space; a model picker sits in the composer; and an Apple Watch app reads chats and answers requests. **OpenHands 1.42.0** (18 November) [O4] chooses among connected git providers and fixes its automations' webhook check. Hermes Agent and OpenMausBot shipped nothing new beyond canaries, and Grok Bot's release notes list nothing since its launch [G1]; its own pages, read again, still say "All your Bots share that computer", "When one Bot signs in to a site, your other Bots are signed in too" and "Your Bots aren't separated from each other" [G12].

Galahad, 19 November: **edit before you approve** (an approval's texts are yours to change before your yes; your version is what's sent, the one asked is declined saying which it became: PLAN #45), and work with a budget (a task's, an outcome's) runs only on a model whose spend it can count, so a fall to an unpriced model can't spend past it unseen. Not taken: meeting bots and voice (your word of 14 November: no voice yet), and a model screening approvals (declined: the oath's classes and your word decide).

## Devin Bots, 18 November

Cognition launched **Devin Bots** on 17 November 2026 [C1][C3]: "a persistent agent with its own memory and tools that can lead multiple Devins in parallel". You give a Bot an *outcome* to own; it plans the work, starts a child Devin session for each piece (each on a machine of its own), watches them, judges what came back and decides what's next, for days or weeks [C1][C2]. It is Cognition's answer to OpenAI's Dots and Anthropic's Claude Duet (a proactive agent in research preview for Pro and Max subscribers since 21 October [U1]), and it is not tied to one lab's models [C3].

| | Devin Bots | Galahad |
|---|---|---|
| **The unit** | A Bot owns an outcome or a standing responsibility; a Devin session is one task [C1] | An outcome Galahad owns for weeks, since 18 November: its own room with the knights you name, tasks he gives them within its budget, a daily report (PLAN #43); a task is one quest in a knight's VM |
| **Where it runs** | Cognition's cloud: a machine per child session, network policy per host, admins choose the repositories and tools a Bot reaches [C2][C3][C4] | Your own machines: a microVM per knight behind its own firewall, keys sealed and never in a VM |
| **Checking the work** | CI, Devin Review, screenshot tests, before-and-after videos, recorded user flows; teams choose what a human reviews and what merges on its own [C1][C3] | Gates that must pass and an independent reviewer on every quest, an auditor on long runs; a pull request's CI followed after a ship |
| **What needs you** | A "Needs you" list of decisions, PRs to review or merge, permission requests, reports and FYIs, each answered, snoozed or dismissed [C2] | The Inbox: approvals, notices, drafts, key and connector requests, dismissed by you |
| **What starts work** | Schedules and events from Slack, Teams, GitHub (issues, PRs, reviews, check runs, pushes), GitLab, Linear, Jira, Pylon, PagerDuty, and signed webhooks; a preflight filter (a model or a script), 50 runs an hour by default, a spend cap per session [C4] | Schedules, signed webhooks, new mail, GitHub's failed runs and pushes (PLAN #13); a burst within a cooldown is one run |
| **Reach** | Its own Slack app, iMessage, the web app and an iOS app [C1][C2] | The PWA, iPhone, iPad and Mac apps, Telegram, Slack |
| **Memory and access** | Memory files it writes (preferences, corrections, project details), shared with whoever may use it; its own connections and secrets, asking before it takes on new access [C2] | One shared memory, each knight's own notes, what he knows of you; connectors his alone unless you allow an agent |
| **Scale it reports** | The Android version of Devin's app in 44 days: 1,134 merged PRs, 344,651 lines of Kotlin, 2,841 screenshot tests, from 183 messages (one per six PRs); a studio run by about 20 Bots and one person, from 50 to 1,900 PRs a week [C1] | Its north star, your interventions per task done and verified, counted on real work since 18 November (the Overview, `galahad roundtable`, and per outcome since 19 November); its trials are eight tasks of its own; a knight's work first landed on its own main on 19 November (one task: 35 minutes, 52 commands, $0.70, verified by its gates and the reviewer, with no step of yours) |
| **Price** | Counts toward a Devin plan's usage like any session [C2]; no price of its own published [C3] | Your machines and your keys or plans; dollars per task shown |

What it shows Galahad: the outcome a lead owns over weeks (a plan, tasks fanned out to knights in parallel, results judged, a daily report, decisions sent to you) is the next layer above knights and quests, which Galahad built the next day (PLAN #43), each task still gated and reviewed in its own VM. Cognition counts the number Galahad's mandate is built on, human messages per merged change (183 for 1,134), which Galahad began counting on its own work the same week. And its triggers, its "Needs you" kinds and its recordings of the work being tested are each a step past Galahad's.

## Where Galahad leads, and where it trails

**Leads.** Each knight's work is in a VM of its own, on hardware you own: of the eight others, none keeps every agent's work apart by default (the coding consoles run on your host or in a worktree; Grok Bot's bots share one computer). Work counts as done only through gates and an independent reviewer, and an auditor watches a long run. Keys are sealed and pinned, and no model or VM ever holds one. Pairing is signed per request; an approval is your word on a card, never a model's score. Local models on any node serve the whole fleet, and any model or coding plan serves any role. It is small enough to read: about 115,000 lines (19 November) against Hermes Agent's 1.2 million (the [site](https://galahad.sh/#scale) draws them to scale).

**Trails.** It has counted its own north star, human interventions per completed task, on real work only since 18 November, and not yet in its census, scorecard or trials (#28). Since 18 November a failed check or a review on a knight's pull request goes back to that knight on its branch, with the push yours to approve, but outside an outcome only once you turn it on, where Orchestrator.inc sends them back by default; since 19 November a conflict with the base branch goes back too, as there and in T3 Code (#29). Since 19 November a knight runs in any agent that speaks ACP, as in T3 Code and OpenHands, beside the four tools Galahad configures itself; which does best on your work is not yet measured (#30). Of the chat apps, Telegram and Buzz communities so far (#19, #46). Since 19 November a knight's task can be given again from any of its steps, its files as they stood then, but the conversation isn't kept with them and a coding tool's run isn't stepped (#15). The iPhone app is in testing, not in the App Store (#33); the Android app (since 20 November) is an APK, not in Google Play, and has no notifications yet (#51); and the Mac app is its only desktop one. Its numbers are eight tasks of its own; OpenHands publishes an index of public benchmarks, and nothing yet measures Galahad against the others on the same tasks (#32). What comes next is in the [PLAN](PLAN.md).

## Sources

Read on 16 November 2026; T, A, O, H14, R14, M11, D10 and D11 on 18 November; C and U1 on 18 November (Devin Bots launched the day before); R15, O4, G1 and G12 on 19 November.

- **T1** https://github.com/pingdotgg/t3code (README), https://t3.codes
- **T2** https://github.com/pingdotgg/t3code/releases/tag/v0.1.10
- **T5** https://github.com/pingdotgg/t3code/blob/main/docs/user/permission-modes.md
- **T6** https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md
- **T7** https://github.com/pingdotgg/t3code/blob/main/docs/user/source-control.md
- **A1** https://github.com/OrchestratorInc/agent-orchestrator (README)
- **A2** https://github.com/OrchestratorInc/agent-orchestrator/releases/tag/v0.15.3
- **A3** https://github.com/OrchestratorInc/agent-orchestrator/blob/main/frontend/e2e/ci-auto-inject.spec.ts
- **A4** https://docs.orchestrator.inc
- **O1** https://github.com/OpenHands/OpenHands (README)
- **O2** https://github.com/OpenHands/OpenHands/releases/tag/v1.41.0
- **O3** https://openhands.dev/blog/openhands-index
- **H14** https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.2
- **R14** https://github.com/elie222/rakazo/releases/tag/v0.12.0
- **R15** https://github.com/elie222/rakazo/releases/tag/v0.13.0
- **O4** https://github.com/OpenHands/OpenHands/releases/tag/v1.42.0
- **M11** https://github.com/milind-soni/OpenMausBot/releases (0.1.165 to 0.1.169)
- **D10** https://learn.chatgpt.com/docs/dots
- **D11** https://learn.chatgpt.com/docs/dots/computers-and-apps

- **H1** https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.0
- **H2** https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.1
- **H3** https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.1%2Bcanary.20261116T070005Z
- **H4** Hermes Agent's `SECURITY.md` §2.2 (version 0.21 checkout)
- **H5** Hermes Agent's `hermes_state.py` (version 0.21 checkout)
- **H6** https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/desktop.md
- **H7** Hermes Agent's `gateway/platforms/` and `plugins/platforms/` (version 0.21 checkout)
- **H8** https://github.com/NousResearch/hermes-agent/blob/main/README.md
- **H9** https://f-droid.org/packages/com.m57.hermescontrol/
- **H10** https://github.com/NousResearch/hermes-agent/blob/main/website/docs/guides/manage-hermes-cloud-with-mcp.md
- **H11** Hermes Agent's `skills/software-development/` (version 0.21 checkout)
- **H13** https://github.com/NousResearch/hermes-agent/blob/main/LICENSE
- **R1** https://github.com/elie222/rakazo/releases/tag/v0.11.0
- **R2** https://github.com/elie222/rakazo/blob/main/README.md
- **R3** https://github.com/elie222/rakazo/blob/main/docs/run-execution.md
- **R4** https://github.com/elie222/rakazo/blob/main/docs/messaging-apps.md
- **R5** https://github.com/elie222/rakazo/blob/main/docs/mobile-app.md
- **R6** https://github.com/elie222/rakazo/blob/main/docs/desktop-app.md
- **R7** https://apps.apple.com/app/rakazo/id6801531099
- **R8** https://github.com/elie222/rakazo/tree/main/apps/web/src/pwa
- **R9** https://github.com/elie222/rakazo/blob/main/docs/agent-verification.md
- **R11** https://github.com/elie222/rakazo/releases/tag/android
- **R12** https://github.com/elie222/rakazo/releases
- **R13** https://github.com/elie222/rakazo/blob/main/LICENSE
- **M1** https://github.com/milind-soni/OpenMausBot/releases
- **M2** https://github.com/milind-soni/OpenMausBot/blob/main/LICENSING.md
- **M3** https://github.com/milind-soni/OpenMausBot/blob/main/README.md
- **M4** https://github.com/milind-soni/OpenMausBot/blob/main/apps/docs/content/docs/computers/local-vm.mdx
- **M5** https://github.com/milind-soni/OpenMausBot/blob/main/docs/approval-levels.md
- **M6** https://github.com/milind-soni/OpenMausBot/blob/main/docs/ios-companion.md
- **M7** https://apps.apple.com/app/id6803387923
- **M8** https://github.com/milind-soni/OpenMausBot/blob/main/docs/team-slack.md
- **M9** https://github.com/milind-soni/OpenMausBot/blob/main/docs/runtime-contract.md
- **M10** https://github.com/milind-soni/OpenMausBot/blob/main/docs/phone-web-app.md
- **G1** https://docs.x.ai/release-notes
- **G2** https://apps.apple.com/app/id6794501026
- **G3** https://docs.x.ai/grok-bot/security-faq
- **G4** https://docs.x.ai/grok-bot/security
- **G6** https://docs.x.ai/grok-bot/computers
- **G7** https://docs.x.ai/grok-bot/chat-and-collaboration
- **G8** https://docs.x.ai/grok-bot/faq
- **G9** https://docs.x.ai/grok-bot/mobile
- **G10** https://docs.x.ai/grok-bot/microsoft-teams
- **G11** https://docs.x.ai/grok-bot/skills-routines-and-automations
- **G12** https://docs.x.ai/grok-bot/how-grok-bot-works
- **D1** https://learn.chatgpt.com/docs/dots
- **D2** https://learn.chatgpt.com/docs/dots/channels
- **D3** https://learn.chatgpt.com/docs/dots/computers-and-apps
- **D4** https://learn.chatgpt.com/docs/enterprise/dots-security
- **D6** https://community.openai.com/t/fresh-dots-updates-create-in-the-mobile-app-delegate-to-codex/1404834
- **D9** https://siliconangle.com/2026/09/29/openai-launches-dots-always-on-ai-agents-in-chatgpt-with-their-own-cloud-computers/
- **C1** https://devin.ai/blog/introducing-devin-bots
- **C2** https://docs.devin.ai/work-with-devin/bots
- **C3** https://fortune.com/2026/11/17/exclusive-cognition-bets-on-devin-bots-coding-agents-in-challenge-to-anthropics-duet-and-openais-dots/
- **C4** https://docs.devin.ai/product-guides/automations
- **U1** https://9to5mac.com/2026/10/21/anthropic-takes-on-chatgpt-dots-and-meta-muse-with-claude-duet/
