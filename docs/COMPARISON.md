# How Galahad compares

Galahad next to five agents people use for the same work, surface by surface: where each one runs, how its work is kept apart and checked, and how you reach it from a browser, a desktop and a phone. Read on **16 November 2026** from each project's own releases, documentation and App Store listings; every fact has its source below. Products change quickly (Rakazo shipped seven releases between 3 and 12 November), so this page says when it was true, and is redone rather than guessed at.

| | Version on 16 Nov | Licence |
|---|---|---|
| **Galahad** | `main` | Apache-2.0 |
| **Hermes Agent** (Nous Research) | 0.23.1, 9 Nov [H2] | MIT [H13] |
| **Rakazo** (elie222) | 0.11.0, 12 Nov [R1] | Apache-2.0 [R13] |
| **OpenMausBot** | 0.1.161, 15 Nov [M1] | Apache-2.0, with a source-available `enterprise/` part [M2] |
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
| **Galahad** | The full app, an installable PWA from your node | A Mac app (macOS 27): client and node in one, notarized and self-updating; elsewhere the PWA, installed | Native (SwiftUI), in testing on TestFlight | The PWA | An invite and a six-digit code on both screens; the device's key never leaves it (Secure Enclave on iPhone); every request signed, each route its own scope |
| **Hermes Agent** | A Webapp, off by default, no PWA found [H1][H6] | Electron: macOS and Windows [H1][H3] | None official | The CLI under Termux; a third-party app over the LAN in plain HTTP [H8][H9] | A one-use link locally; remotely a Nous account or a password gate behind a tunnel; plain HTTP on the LAN [H6] |
| **Rakazo** | A web app with a service worker [R2][R8] | Electron: macOS, Windows, Linux [R6] | App Store (Expo) [R7] | Google Play and an APK [R5][R11] | A rakazo.com account, or your server's HTTPS address [R5] |
| **OpenMausBot** | A phone web app [M10] | macOS, Windows, Ubuntu (beta) [M3] | App Store [M7] | Google Play named in its docs (unconfirmed) [M6] | QR pairing, trust kept per device in the Keychain, revocable; a relay, Tailscale or the LAN [M6][M1] |
| **Grok Bot** | None; X Chat reaches the bots [G7] | macOS, Windows, Linux [G8] | App Store [G9] | Google Play [G9] | A Cursor account, with SSO [G4] |
| **Dots** | ChatGPT in a desktop browser; not on mobile web [D2] | The ChatGPT desktop app [D2] | The ChatGPT app [D6] | The ChatGPT app [D6] | A ChatGPT account [D2] |

## Reach

| | Chat apps | What starts work besides you |
|---|---|---|
| **Galahad** | None yet ([PLAN #19](PLAN.md)) | Schedules (loops), the heartbeat, a pull request's CI after a ship; events are [PLAN #13](PLAN.md) |
| **Hermes Agent** | About 30 adapters: Telegram, Slack, Discord, WhatsApp, Signal, iMessage, Teams, Matrix, email and more [H7] | Schedules |
| **Rakazo** | Teams, Slack, Telegram, iMessage/SMS, WhatsApp, Feishu [R4][R1] | Routines, and since 0.11 a page that changes [R1] |
| **OpenMausBot** | Slack, through its cloud only [M8] | Automations [M1] |
| **Grok Bot** | Slack, Teams, X Chat, @bot on X [G7][G8][G10] | Slack, email and GitHub events [G11] |
| **Dots** | Slack, Teams, calls, iMessage/RCS texting (beta) [D2] | The Slack channels and events you name [D1] |

## Where Galahad leads, and where it trails

**Leads.** Each knight's work is in a VM of its own, on hardware you own. Work counts as done only through gates and an independent reviewer, and only Galahad publishes numbers for it. Keys are sealed and pinned, and no model or VM ever holds one. Pairing is signed per request. It is small enough to read: about 85,000 lines against Hermes Agent's 1.2 million (the [site](https://galahad.sh/#scale) draws them to scale). Any model or coding plan serves any role.

**Trails.** No chat apps yet, and nothing but schedules starts work. The iPhone app is in testing, not in the App Store, and there is no Android app of its own, and the Mac app is its only desktop one (17 November). Files with a message (pictures, text) go from the PWA and the terminal; the iPhone and Mac apps can't attach them yet. The trials say how well Galahad does on its own suite; nothing yet measures it against the others on the same tasks. What comes next is in the [PLAN](PLAN.md).

## Sources

Read on 16 November 2026.

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
