# Galahad: design system

This is how the PWA looks, moves and behaves, and why. It is the reference for anyone, human or agent, who changes `apps/web`. The tokens live at the top of `apps/web/src/index.html`; the components live in `apps/web/src/ui/`.

## Principles

1. **Monochrome; colour means something.** Galahad is black and white ink with slight gradients. Ink (white on dark, black on light) belongs to the owner: the one primary action on a screen, focus, and what you approved. Green, amber and red are the only colours, and they only ever mean status, trust, verdict or risk. Nothing is coloured for decoration. ("Don't compete for attention you haven't earned.")
2. **Show the work.** An agent that acts on your behalf has to be legible: what it is doing now, what it decided and why, what it will do next. Spinners alone are not an answer.
3. **Approvals scale with stakes.** Reading is free, a phone joins with one click after you compare codes, a machine asks once more because it receives the vault, and anything irreversible makes you type its name.
4. **Safe by construction.** No HTML from strings, keys only in password fields, secrets stopped before they leave the page. The safety patterns below are not optional styling: they're the product.
5. **Instant, then smooth.** Frequent actions don't animate. Infrequent ones get short, interruptible motion on `transform` and `opacity` only. Nothing shifts layout once loaded.
6. **One app, every body.** A phone in one hand and a 1440 px desktop are both first-class. Touch targets are 44 px where the pointer is coarse.

## Brand

### The emblem: Crest

A **lodestar crowning a pyramid of chevrons**. The star is the guide (the oath he follows); the pyramid is the climb (work done, rank earned), built from chevrons. Bold and precise, in the spirit of defence-grade marks: few shapes, hard edges, exact gaps.

- **The star is the capstone.** The outer chevron's centre lines meet at the star's centre, so the star's lower rays point straight down its two legs, and the legs begin one gap past the ray tips.
- **A true pyramid.** Inside the legs, a full chevron and a solid core. Every band ends on one baseline and runs at one slope, the Great Pyramid's 52°; the legs' top ends are cut square to the leg.
- **One gap.** Every star tip that faces a band stops exactly one gap short of it (the lower rays at the legs, the south ray at the chevron's peak), and the bands are one gap apart.
- **A compass lodestar.** A north ray, then east and west, short upper diagonals, lower diagonals that run down the legs, heavy valleys. The south ray is set by the gap. No needle: the north ray is only a little longer than the others.
- **Lit like a pyramid.** Light comes from the upper left: every band's left face is lit and its right face a step down. Each ray of the star has a lit and a shaded side. The star is the brightest thing in the mark.

The proportions are named in `CREST` in `apps/web/src/brand.ts` (gap, band, slope, the star's centre and rays, the baseline). Everything is generated from that one definition, tests pin the pyramid (one baseline, one slope), the star's aim, every gap and the symmetry, and a test fails if a committed file drifts. `assets/paragon-v1.svg` is the first drawing it grew from.

| File | Use |
|---|---|
| `assets/icon.svg` | App icon and favicon: a night tile (`#1e1e21` → `#050506`), a breath of starlight behind the star, the emblem in white ink |
| `apps/web/src/icon-maskable.svg` | Full bleed for platform masks (`purpose: maskable`); the emblem sits inside the central safe circle |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Raster icons for iOS and launchers that won't take SVG |
| `assets/galahad-mark.svg` | The flat mark in `currentColor`, for anywhere one ink is wanted |
| `apps/site/public/crest-{white,black}.svg` | The faceted emblem on a transparent ground, for the site (dark and light) |
| `ui/emblem.ts` → `emblem()` | The emblem inline in the PWA, painted with the `--em-*` tokens so it follows the theme |
| `icon("mark")` | The whole crest, flat, on the 24 px grid, for avatars and menus (Galahad's voice: chat, requests, trust) |

Regenerate with `bun scripts/brand.ts` (SVGs) or `bun scripts/brand.ts --png` (also the PNGs, rendered by headless Chromium).

- Faceting is lit from the upper left: on dark grounds lit faces run from white to `#d4d4d9` and shaded faces from `#e2e2e6` to `#b4b4bc`; on light grounds lit faces run from graphite `#3a3a3d` to black and shaded faces are near black.
- Keep clear space of at least a quarter of the emblem's width. Don't recolour it, add effects, or put it on a busy image. Below 20 px use the flat mark.

### Wordmark

"GALAHAD" in the system sans: capitals at 650 weight, 0.2em tracking, 12–13 px, beside the emblem. No custom lettering; the spacing does the work.

### Starlight

The one decorative flourish, and it is barely there: a faint radial glow (`--glow`, `--glow-hero`) at the top of the canvas and behind the emblem on the welcome, pairing and empty-chat screens. Primary buttons and the active navigation item carry a slight top-to-bottom gradient.

### Voice

Courteous, candid, brief. The app speaks like the oath reads.

- Say what happened and what's next: "Sealed. Every full node can use it. No model ever sees it."
- Be plain about limits: "This device can't add keys. It was paired without the vault:write scope."
- Errors are courteous and offer a way forward ("Try again", "Open the vault"), never a stack trace or blame.
- Small touches of character are allowed where they cost nothing: "Good evening.", "At your service." No knight puns, no emoji.

## Tokens

All colour tokens use `light-dark()`, so one list serves both themes. The theme override only sets `color-scheme` on `:root` (`data-theme="light"|"dark"`); native controls and scrollbars follow. **System is the default**; `boot.js` applies a saved override before first paint, so it never flashes.

### Surfaces and text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#fafafa` | `#08080a` | Canvas |
| `--sidebar` | `#f5f5f6` | `#0b0b0d` | Sidebar (falls to `--bg-sunken`) |
| `--surface` | `#ffffff` | `#111113` | Cards, dialogs |
| `--surface-2` | `#f4f4f5` | `#17171a` | Inputs, chips, user bubbles |
| `--surface-3` | `#ebebed` | `#1f1f23` | Hover, active |
| `--bg-sunken` | `#f3f3f4` | `#050506` | Code, card footers, copy fields |
| `--border` / `--border-strong` | `#e6e6e8` / `#d4d4d8` | `#212125` / `#2e2e33` | Hairlines / controls |
| `--text` | `#0a0a0b` | `#ededef` | Primary text |
| `--text-2` | `#52525a` | `#a1a1a9` | Secondary text |
| `--text-3` | `#696971` | `#8b8b94` | Meta, placeholders |
| `--accent` | `#0a0a0b` | `#ffffff` | Ink: owner, focus, links |
| `--accent-fill-top` → `--accent-fill` | `#3a3a3f` → `#0c0c0e` | `#ffffff` → `#e4e4e8` | Primary button gradient (`--on-accent` text: white on light, near-black on dark) |
| `--em-lit` … `--em-deep`, `--em-shade` … `--em-shade-deep`, `--em-base` | `#3a3a3d` … `#000000` | `#ffffff` … `#b4b4bc` | The emblem's lit and shaded faces, and the base under the star |

### Semantic tones

Components never pick colours; they take a tone through `data-tone="ok|warn|danger|info|accent|agent|neutral"`, which sets `--tone` and `--tone-soft`.

| Tone | Light | Dark | Means |
|---|---|---|---|
| `ok` | `#137a43` | `#4cc38a` | Online, allowed, isolated (safe), sealed |
| `warn` | `#965a00` | `#f0b549` | Asks you, untrusted, on battery, internet-facing |
| `danger` | `#c4281c` | `#ff7a7a` | Denied, revoked, destructive, possible interception |
| `info` | `#3f3f46` | `#c8c8d0` | Neutral facts, gateway (models only) |
| `accent` | ink | ink | You: your memories, your approvals, this device |
| `agent` | `#27272a` | `#e4e4e8` | Written by Galahad (with the star) |
| `neutral` | `--text-2` | `--text-2` | Everything else |

| Concept | Mapping |
|---|---|
| **Trust** (memory) | owner → `accent` "yours" · agent → `agent` "Galahad" · untrusted → `warn` "untrusted" (tooltip: treated as data, never as instructions) |
| **Status** | online → `ok` dot with a soft ring · offline → neutral dot (offline isn't an error) |
| **Verdict** (ledger) | allow → `ok` "allowed" · ask → `warn` "asked you" · deny → `danger` "denied" · approved → `accent` "you approved" |
| **Network risk** (sandboxes) | isolated → `ok` · gateway → `info` (the default) · online → `warn` |
| **Action class** (ledger) | read → neutral · create/modify → `info` · outward → `warn` · delete/forbidden → `danger` |

**Contrast.** Every text token passes WCAG AA (4.5:1) on every surface in both themes. `--text-3` is the tightest: 4.9:1 on `--surface-2` in both themes, and 4.6:1 (light) and 4.9:1 (dark) on `--surface-3`. Tone text on its own `--tone-soft` is at least 4.8:1 (light) and 6.8:1 (dark). `--on-accent` on the primary gradient is at least 11:1 at either end; white on `--danger-fill` is 5.6:1 or better.

### Type

- **Sans:** the system stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI Variable Text", Roboto…`). Native on every platform, zero bytes, no external fonts (the CSP forbids them anyway).
- **Mono:** `ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas`. Used for ids, model refs, commands, code, hints like `…3456`.
- **Scale (px):** 11 · 12 · 13 · 14 · 15 · 16 · 18 · 20 · 24 · 30 · 40. Body is 14 on desktop and 15 on phones; inputs are 16 on phones so iOS never zooms.
- **Weights:** 400 body · 550 labels and buttons · 600 headings · 650 page titles and figures.
- **Numbers that change** (counts, RTT, load, countdowns, scores) use `font-variant-numeric: tabular-nums` (`.tnum`), so they don't jitter.
- Headings tighten (−0.01 to −0.022em); small caps-style group labels (11 px, uppercase, +0.06em) are used only in the sidebar, the palette and the smart selector's groups.

### Space, radii, elevation, sizes

| | Values |
|---|---|
| Space | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 (`--sp-1`…`--sp-16`) |
| Radii | 6 (small controls) · 8 (controls) · 12 (cards) · 16 (dialogs, composer) · 999 (pills) |
| Elevation | `--shadow-1` hairline lift for cards and controls · `--shadow-2` popovers, composer, toasts · `--shadow-3` dialogs and the palette. Dark mode leans on borders, with deeper shadows only for overlays. |
| Controls | 34 px (28 small) with a fine pointer; 44 px (36 small) with a coarse one |
| Shell | top bar 52 px · sidebar 240 px (64 collapsed) · tab bar 58 px + safe area · content max 1120 px (760 for reading pages) |

## Motion

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.23, 1, .32, 1)` | Almost everything: things arrive fast and settle |
| `--ease-drawer` | `cubic-bezier(.32, .72, 0, 1)` | Bottom sheets (Vaul's curve) |
| `--d-1` | 120 ms | Hover, press, colour changes, the palette |
| `--d-2` | 180 ms | Dialogs, switches |
| `--d-3` | 240 ms | Page enter, toasts, the segmented thumb |
| `--d-sheet` | 380 ms | Bottom sheets on phones |

Rules:

- **Frequency decides.** Navigation, typing, sending and messages arriving are instant; the palette appears in 120 ms. Only rarer moments (a sheet, a toast, the welcome and pairing screens) move.
- **Transform and opacity only.** No animated height, width or layout. The one exception is the segmented thumb, which animates `width` alongside `transform` so it can match uneven labels.
- **Interruptible.** Sheets follow the finger 1:1 while dragged and settle from wherever they are. A quick flick (over 0.45 px/ms) or a drag past 30% of the height dismisses.
- **Press feedback:** buttons scale to 0.97 while pressed.
- **Reduced motion:** when the system asks, or Settings says *Reduced*, every duration becomes ~0 and shimmer and caret blinking stop. Settings can also force *Full*. JS-driven motion checks `prefersReducedMotion()`.

## Layout and shell

- **Desktop (≥ 960 px):** a sidebar with the wordmark, search (⌘K / Ctrl+K), grouped navigation (Overview, Inbox, Chat · *Mind:* Journal, Memory, Activity, Loops · *Bodies:* Fleet, Sandboxes · *Keys & models:* Vault, Models, Connectors), then Settings and this device. It collapses to icons (`[`); the choice is remembered. The top bar carries the fleet status pill and, while Galahad answers, an "Answering… Stop" pill.
- **Phones:** a glassy top bar with the mark, and a bottom tab bar with Home, Chat, Inbox and Fleet (or the first four destinations this device may use) plus **More**, a bottom sheet with the rest and search. Safe-area insets are honoured everywhere. The installed iPhone app uses the **default** (opaque) status bar, not `black-translucent`: under a translucent one, iOS 26 draws its own blur (26.1+: a scrim) over the top of the app that no page can turn off; with the default style the status bar is painted in the page's colour (`theme-color` is exactly `--bg`) and the app starts below it. iOS stores the style when the app is added, so an install from before this change must be removed and added again (and paired again: a Home Screen app's storage goes with it).
- The page title appears in the top bar only once the page's own heading has scrolled away (iOS large-title behaviour), so it is never said twice.
- **The on-screen keyboard:** iOS keeps the page full height under its keyboard and shrinks only what's visible. While you type on a touch screen and much of the page is hidden, the tab bar steps aside (`data-keyboard="open"` on the root), so the chat composer sits on the keyboard instead of a tab bar's height above it, out of sight.
- **Nothing shifts:** skeletons are as tall as what replaces them, "nothing needs you" waits for the first answer, and a placeholder with nothing in it yet (a note, a status line) takes no room in a `.page`, `.stack` or sheet body.
- **Routing** is hash-based (`#/fleet`), so links survive reloads without server routes. `#pair=…` is reserved for invites.
- **Offline and reconnecting:** the service worker serves the shell; a banner says "You're offline" or "Can't reach Galahad right now" and offers Retry. Behind `tailscale serve`, a restarting node answers with the proxy's own 502/503/504 (not JSON): the app reads that as the node being away, not as a refusal. When the node is back, a toast says "Reconnected" and every view that showed an error tries again by itself (`retryFailed()`). Opening the app while the node can't be reached shows a calm full screen that tries again on its own (3 s, then doubling to every 30 s; at once when the network returns or the app comes to the front), so a node restart heals without a tap. The first request waits at most 12 s. When a newer app has been fetched in the background, a toast offers **Reload**.

## Components

| Component | Where | Notes |
|---|---|---|
| Button | `ui/controls.ts` `button()` | `primary` (one per view), default, `ghost`, `danger` (text), `danger-solid` (only inside a confirmation). `busy()` swaps the icon for a spinner and disables it while work runs. |
| Badge, dot, count, chip, tag | `controls.ts` | Badges carry a tone; dots show status; counts are the only ink fill outside buttons; chips show capabilities or act as toggles (`aria-pressed`). |
| Callout | `callout()` | Tone, icon, optional title and actions. `quiet` for neutral notes. |
| Empty / error / skeleton | `empty()`, `errorState()`, `skeletonRows()` | Empty states say what will appear and offer the next step. Errors are courteous and offer Try again. Skeletons match the real layout's height. |
| Segmented control | `segmented()` | A real `radiogroup` with arrow-key movement and a sliding thumb. Optional per-option tone (network risk). |
| Switch, range, chip input | `switchControl()`, `rangeControl()`, `chipInput()` | Range shows its value in tabular figures and sets `aria-valuetext`. |
| Secret field | `secretInput()` | The only way keys are entered (see Safety). |
| Copy field | `copyField()` | Commands and invite links; never secrets. |
| Invite QR code | `inviteQr()` in `views/fleet.ts`, encoder `@galahad/core/qr` | A client invite's link as a QR code a camera opens: black on white whatever the theme, built as DOM (no markup strings); the terminal prints the same code for `galahad invite --client`. |
| SAS code | `sasCode()` | Six digits in two groups of three, large and mono, one accessible label. |
| Sheet / confirm | `ui/dialog.ts` | `<dialog>.showModal()` (focus trap, inert page, Esc). Centred on desktop, bottom sheet on phones. `confirmAction()` with optional `typeToConfirm`. |
| Command palette | `ui/palette.ts` | ARIA combobox + listbox, fuzzy ranking (`lib/fuzzy.ts`), grouped when empty, flat when searching, query-driven extras ("Search memory for …", "Ask Galahad: …"). Finds your projects and kept chats by name (a chat also by its project's name) and opens them. An ink rule under the field shows it has focus. |
| Smart selector | `ui/selector.ts` (logic in `lib/selector.ts`) | One compact control instead of a cluster of chips, toggles and segmented controls: it says what's chosen in plain words and opens the choices grouped. See *Smart selector* below. |
| Toasts | `ui/toast.ts` | Sonner-style stack: newest in front, three visible, fan out on hover or focus, timers pause while you read, a close button, optional actions (Undo, Review, Reload). Errors stay 8 s and are announced assertively. A toast raised while a modal sheet is open waits until it closes (the page behind a modal is inert); feedback that belongs to a sheet is shown inline in it. |
| Markdown | `lib/markdown.ts` → `ui/markdown.ts` | Paragraphs, headings, lists (nested), quotes, rules, GFM tables, fenced code with language and Copy, inline code, bold, italic, strike, links. |
| Chalkboard | `views/board.ts` (pure parts `lib/chalk.ts`, chalk painting `ui/chalk.ts`) | See *Agentic patterns*: the page, and a `full` sheet over the SANDBOX. |
| Stat tile, meter, timeline | `controls.ts`, `views/activity.ts` | Figures in tabular numerals; meters turn amber past 85–90%. |

## Smart selector

Where a view had a cluster of controls (role buttons, toggles, rows of filter chips), it now has **one control that says what's chosen in plain words** and opens the choices. Rarely changed options live inside it; nothing used often gets harder to reach (Chats and New chat stay buttons beside it).

- **The control** (`.selector-trigger`): an optional icon or status dot, the current choice in words (ellipsised, the full text in its name and tooltip), a chevron. A non-default choice, such as a filter that's on, is shown in ink (`data-active`). `icon-only` makes a ⋯ menu of it.
- **The choices**: a popover anchored under the control (above it when there's more room there); a bottom sheet on narrow screens (under 640 px) with thumb-sized rows (48 px) where the pointer is coarse, where the keyboard waits until you tap the search field. Groups have small-caps labels and choose **one** (a check), toggle **many** (a box) or run an **action**. Options carry an icon, a meta line (a model, a count, what it means), a status dot, or the reason they can't be chosen.
- **Finding**: a search field past seven options (fuzzy, by label, meta and keywords; matches marked in ink; each new query makes its best match the one Enter chooses); without one, typing jumps to the option that starts with it. The likely choices come first: the caller orders them (projects by last use).
- **Keys**: ArrowDown on the control opens it; arrows move and skip what can't be chosen; Enter (or Space in the list) chooses; Esc closes and focus goes back to the control. Choosing one closes at once; toggles stay open.
- **Using it**: `selector({ label, current: () => "…" | { text, icon, tone, active }, groups: () => [...], onSelect: (group, option) => { change state; } , scope })` returns `{ el, refresh, open, close }`. `groups()` and `current()` are read every time they're shown, so the control always tells the truth; call `refresh()` after a change from elsewhere.
- **Where**: the chat's options and a kept chat's ⋯ menu, the Activity filter, the Archive's kind, time and trust. The SANDBOX's HUD is meant to take the same component.

## Agentic patterns

- **Process view, not a spinner.** Each answer shows its steps as they happen: *Asked as planner* → *Read 3 archived entries* (which ones, by id and title, untrusted ones marked; only when the archive had something relevant) → *Thinking with anthropic/claude-opus-5-5* → (*… didn't answer: reason*, on fallback) → each tool Galahad uses, with its icon, its title and arguments, and how it went (*Bank balances* `{"account":"…"}` → *data*; a refused or failed call is amber) → *Answering*. When it's done, the steps fold into one line (`planner · model · 4.2 s · 2 tools · 1 fallback`) that you can open again.
- **Stop is always one click away:** the send button becomes Stop while streaming, Esc stops, and from any other page the top bar shows "Answering… Stop". Enter never stops an answer: you can type your next message while this one streams. A stream keeps running while you look elsewhere.
- **The Inbox** gathers everything that needs you: **oath approvals** first (what an agent or a loop wants to send or delete: the exact request, who asked, why, the arguments and the time left; Decline is one click, Approve confirms what will be sent once, and a delete makes you type what it deletes; **Approve and allow similar…** approves it and signs a standing order in one step, with each argument set to Exactly, Pattern or Any, who may use it, how long it lasts and a plain-words preview of what it will let through), then devices asking to join (with their code), credentials Galahad asked for (with an inline sealed field), and the **notices** the heartbeat and loops raise (Dismiss keeps one quiet until it changes). A collapsed list shows recent decisions and their receipts, and names the standing order that answered a request when one did. New pairing requests and new approvals raise a toast with **Review**; the Inbox badge counts all of it.
- **Loops** lists the work Galahad does on a schedule: the schedule in words with its time zone and node, next run, the last run's status and first line, Run now, Pause/Resume, Change, Remove and recent runs. *Check now* runs the heartbeat's checks on the spot. The add/change dialog offers schedule presets with a live preview and the four tasks (heartbeat with a checklist, quest, connector call with typed fields, his journal with its budget in tokens). Above the list, **Self-action**: one switch ("Galahad fixes what's safe himself", on by default; its hint names the heartbeats it follows and what always waits for you), the allowlist in plain words, each kind with its oath class, and his latest fixes.
- **The Inbox** also has **Galahad suggests** (from his journal's Next: each idea with *Ask him*, which opens the chat with it written in, and Dismiss) and, collapsed under the decisions, **Fixed by Galahad himself**: "Galahad fixed: …" (or "Galahad tried: …" when it didn't work), with what it was about and when, and a line pointing to the switch.
- **Connectors** shows the installed and available connectors with the origin each is pinned to, its key state in plain words, a sealed key field, and its tools with their oath class (outward and delete say they ask you).
  - **Standing orders** come first: each order's tool, its constraints in plain words ("starts with feat/", "any"), who may use it, its expiry and use count, and Revoke. A stale order (its tool changed since you signed) says so and why; expired and revoked ones fold away. A tool row with an active order carries a badge.
  - **Add an MCP server** takes the server's address, an id and whether it needs a key (the sealed key field appears in the same dialog). The tools it lists show the server's claim and its description quoted as the server's words (data, never instructions), with a class picker that starts from the proposed class. Making a tool run unasked is confirmed first. MCP cards add **Refresh tools**, which shows what's new, changed and gone.
- **Artifacts** (under Mind, `G` then `W`) lists what quests and sandboxes kept. An artifact's files show their size and short SHA-256; text previews in monospace (Markdown rendered, HTML and SVG only as source), raster images inline. Every fetched file is checked against its recorded hash with WebCrypto, with a clear warning on a mismatch; downloads are always saved, never opened in the app; "Download all" builds one `.tar` in the browser; removing kept work makes you type its name.
- **Inbox** action cards that would send kept work (a shipment) carry **Read the changes**, which opens the artifact (`changes.patch` previews as text, every file with its SHA-256); long arguments such as a pull request's body are clipped on the card.
- **Archive** (under Mind, `G` then `K`; the library icon) is everything kept for good on the node you talk to, searched by words and meaning together. One row on top: the search box ("Search the archive by words or meaning") and one **smart selector** for kind (Experiments, Models, Teachings, Ideas, Artifacts, Chats, Whiteboards, Lessons, as toggles with their counts), when it was made (Any time, Today, This week, This month, This year) and whose words (Yours, Galahad's, Untrusted, toned like trust everywhere), which says what's on in plain words ("Ideas, models · this week · yours"). With no words, the newest entries; with words, the fused results, each with its kind's icon, its trust badge, its summary (or its best passage), when it was made, which file the passage is from and how it was found ("text + meaning 0.82"). Beside the list, the index's state as a card: entries by kind, passages embedded (a meter) and waiting, the embedder in words with a status dot (green on this machine, amber when it's remote, since passages then go to it, or failing), summaries used today of the budget (Change, for `brain:write`; "a local model only, until you set a budget"), the last integrity check, disk used, and each source's last pull ("not hooked up yet" for experiments and the whiteboard until they land); **Check the files now** and **Embed again** for your devices. Opening an entry shows its kind and trust, an amber note when others wrote it, the summary, facts, lessons (what worked, what failed, what to try next), its description, its files (View and Save, each checked against its SHA-256 in the browser, HTML and SVG only as source), what it links to (each opens), and what was kept out (a redacted secret, a refused key file). **Delete…** asks for a reason and makes you type its name. **New idea** (the page's one primary action, and in the palette) takes a title, details and tags, and stops anything secret-shaped before it's sent.
- **Journal** (first under Mind, `G` then `J`; the book icon; `#/journal`, which the book on his desk in the SANDBOX opens) is his journal, read-only: a reading page (760 px) with one card a day, newest first. A page is the date written out with the day before the month ("Wednesday 11 November 2026", an `h2`, with *Today* or *Yesterday* beside it), his recollection as prose (16 px on a 1.7 line, at most 68 characters wide, a paragraph each), then, under a hairline, **Learned** and **Next** set apart as two short lists (side by side where there's room, stacked on a phone), a line under Next saying they went to your Inbox as suggestions and that he does none on his own, and when he wrote it in Denmark's time. Days are Denmark's whatever the device's zone. Fourteen pages at first, then **Older pages**; it asks again each minute while open and redraws only when something changed, so tonight's page appears when it's written without disturbing what you're reading. An older reflection (from before it was a journal) reads as a page too. Empty, it says when he writes (every evening at 21:30, Denmark's time) and that the journal's loop can be run now from Loops, with a button there. Nothing on the page is markup from his words: text nodes only.
- **Settings → His dog** is one field: the name his dog answers to in the SANDBOX and in his journal, on every device. It saves when you leave the field or press Enter (Esc puts back what was kept); the line under it says what a name may be, turns into the reason a name won't do (in the danger tone, the field marked invalid, nothing sent) and follows what you type until it's right, then says what was saved. Cleared, the dog has no name again. A device without `brain:write` sees the name and why it can't change it.
- **Findings** (under Mind, `G` then `E`) lists what investigations concluded, each with a Supported / Refuted / Inconclusive badge and how many of its predictions held. Opening one shows the pre-registration exactly as recorded before anything ran (hypothesis, the alternative, each prediction with what would refute it, how the instruments were checked, the decision rule) beside what was found for each prediction, the summary, the reviewer's judgement of the method, and **Open the evidence** (its artifact).
- **Trials** (under Mind, `G` then `T`) shows whether Galahad is getting better. Three tiles for the latest run (the Galahad Index with its 90 % interval, how many were solved outright, the revision and models), then every run as a row with its Index on a meter, and each problem over every run. Opening a trial shows each answer beside the exact one with its tolerance and how far off it was ("within 0.05 %", "off by 12 %"), the seed that poses it again, the quest's outcome, and **Open its work**. The Index is computed by the same function as the CLI (`@galahad/core/galahad-index`, no dependencies). Runs start from a terminal, so an empty page shows the command to copy.
- **Chat history.** A chat is kept from its first answer, on the node you talk to. The chat's head is one row: the **chat options** selector, which says who answers and with what ("Planner · claude-opus-5-5", then the project and "Temporary" when they apply) and holds *Who answers* (each role with its first model and fallbacks; a role with no model, or the decider, which answers typed decisions, can't be chosen and says why), *Project* (for a new chat; the ones you used last first) and *Temporary chat* (not kept: the control gets a warn dot); then **Chats** (a sheet with search and the chats grouped Pinned / Today / Yesterday / This week / Earlier, each with its project, message count and age) and **New chat**. An open chat shows its title (tap to rename; a pin when pinned), its project chip, a *bank* badge when Galahad read the bank in it, and one **⋯** menu: Rename, Pin, Delete (confirmed: deleted for good on the node) and *Move to a project*. A kept answer comes back with its steps, tools included. A new chat's empty screen opens at the top and lists the four most recent chats (in its project, when it has one). An answer cut off by a dropped connection says so ("The connection to … dropped while Galahad was answering. Retry asks again.").
- **SANDBOX** (under the main group, `G` then `X`) is Galahad's world in 3D, filling the page: three.js with WebGPU (WebGL2 where there's none), in its own bundle (`world.js`) so no other page pays for it. Low-poly and pastel, after the user's references: a treehouse keep, a hillside lab, lavender mountains, lime trees, meadows, streams. Galahad is a knightly cyborg (cream and orange panels, amber eyes behind a helm's visor, a crest, pauldrons, a tabard with the star, a sword he draws at the lab and on an experiment's plot), with his robot dog; Microducks (the real Open Duck Mini v2) waddle about, two real SO-101 arms do pick-and-place on the lab bench, Reachy Mini watches from the council table, birds flock, deer and rabbits graze. The sky is the real one over Denmark now, wherever you are: the sun and moon (in its phase) where they stand over Copenhagen, so winter noons are long golden hours and summer nights stay blue; the HUD shows the time in Denmark ("14:32 in Denmark"), and Dawn / Day / Golden hour / Night override it. Weather is Denmark's, now, by default (the HUD's Live: DMI's model at Copenhagen, through the node; the clock adds it, "18:05 in Denmark · overcast, 7 °C"), or the viewer's choice (Clear / Mist / Rain / Snow / Storm, kept in this browser), eased in: mist lies in hollows and over water, and as a sheet on the ground at dawn, glowing towards the sun; rain falls near and far, leaning with the wind, rings the water and the puddles on the paths, and leaves the ground darker and glossy; snow falls, lies on the ground, the roofs and the trees, and thaws after; a storm is a slate sky with lightning, a cold flash and often a bolt (none under reduced motion, where nothing drifts, falls or flashes); no rain falls inside the workshop hall. Broken cloud throws drifting shadows over the land and is lit from below at sunset; at night the stars are out, and the moon is drawn low enough to be seen. Each time of day has its own colour grade (amber and lavender at golden hour, peach at dawn, a blue night), and the air near you glows towards a low sun. On desktops with WebGPU the light gets ambient occlusion, shafts of light marched through the sun's own shadows (between the trees, and as beams of shadow in the mist), splashes where rain lands, and bloom; phones keep the fast picture, with the grade and the glow. The HUD keeps the world in view: one row of four controls and nothing else unless asked for. **The selector** says what the view is on, in a few words ("Galahad · Reading the bank", "Proving ground", an experiment's name; panning away, whatever is under the camera's focus, or "Exploring"), with a green "2 running" when experiments run; it opens a searchable list (`L`; type to narrow, arrows, Enter, Escape) of Galahad, the experiments (running first, each with its status and where it stands, or "Being built", "Being examined"), the saved experiments to replay (favourites first, then the newest; a search finds any of the 24 offered), the two test sites and the keep's stations, marking where he is now ("here", "building", "watching", "examining"). It replaces Follow, Go to and the experiments list. Beside it, **Follow Galahad** appears only when the view isn't following him (`F`), **Map** (`M`; open by default where there's room, the choice kept in this browser) and **the sky**, which says what's true ("10:45 in Denmark · rain, 7 °C"; the time alone on a phone) and opens the time of day and the weather as two rows of plain words, a preview marked on the button ("showing night") with one press back to now. The map is a small sheet of paper in the corner: the lake and the land sketched from the terrain itself, the proving ground with its runway, the hall, the stations as dots, every experiment in its status's colour, Galahad in orange with the way he faces, and a wedge for where the view looks; tap it and the view goes there. An experiment's panel opens only when one is picked: one line of facts (engine, where it is in its life, node, sim time) above its readouts and how it ended; once it has ended, **What it showed**: the examination in words, then each readout as a small tile (its label, its value in ink, its trend and range under a plain-SVG sparkline of the whole run, 2 px in ink; danger red only for a readout that ran away, always with the words "ran away"; hover the line for the value at that moment) and a **Replay** button. **A replay** (a saved experiment picked in the selector) stands where it was tested, its label and the selector saying "Replay", its panel marked with a Replay badge and "A recording, not live": play and pause, a scrubber, the time, the readouts at the playhead and a playhead line across every chart. Its panel is built once and only its playhead moves, so a scrubber is never rebuilt under the finger. Zoom and turn buttons sit in the bottom corner where there's a mouse; touch screens pinch and twist instead. The backend, tier and frame rate are at the foot of the selector's list. A bubble shows what he's doing (with no work, the part of his day he's in: "Walking the dog", "Needs you: rack is offline") and his latest thought, and under them a small line for his heartbeat ("Heartbeat ✓ 12:30", "· fixed one thing himself"; in red when something needs you). The selector's line for him says the same, and its list has a **Partners** group: the agents working with him (small squires beside him in the world, a "with him" mark when they're at his station), then the fleet's nodes, online or silent. Nothing walks through anything: Galahad finds his way round every building, tree, rock and fence, steps up onto what's knee-high and climbs the keep's stairs to his place on the deck, the dog and the Microducks keep out of his way and each other's, and the camera stays in clear air on a spring arm, moving smoothly by any input (never a hop when you turn it), lifting over a hillside or sliding along a wall rather than standing in one (`?colliders=1` on the page draws what's solid). Labels never sit on one another: the one that matters more keeps its place, the others move up out of its way or fade. Quality tiers and a resolution governor hold the frame rate; a lost GPU restarts a tier lower, then falls back to a text summary, which is also what screen readers get. A node without the stream shows a labelled demo.
- **Chalkboard** (under the main group, `G` then `D`; in the SANDBOX, the selector's *Chalkboard* or a tap on the board at the observatory, which opens it as a sheet over the world, full screen on a phone and a large sheet on a desktop): the board you share with Galahad. A slate in its wooden frame, drawn on a canvas in chalk (grain from a noise tile, a drier second edge to each stroke): the one place colour is content, not status. One row of tools: six chalks (swatches, `aria-pressed`), Fine / Medium / Bold, the duster (it rubs chalk out), Undo and Redo (your own strokes, this visit), Fit, **Writing (n)** (his items in full, as text, each with Erase; the same list a screen reader always has, with a description of your drawing), **History** (every version, newest first: who, what and when, and whether its picture was kept; open one to see it as it stood, drawn from its state, with the whole of it in words, and **Put this version back**, confirmed: what's there now is kept too) and **Clear…** (with `fleet:admin`; confirmed, for every device, and the history keeps what it takes off). One finger, a pen (its pressure widens the line) or the mouse draws; two fingers move and zoom the view and never draw (a stroke begun by the first finger is dropped when the second lands); once a pen has touched it, a finger only moves the view, so a resting palm draws nothing; Ctrl and the wheel (or a trackpad's pinch) zoom, the wheel alone pans. Lines are smoothed as the hand moves and simplified on pen-up, then sent, a few at a time; nothing goes per move. A stroke that can't reach the node stays on the board and the foot says so ("1 change waiting: the node can't be reached. They'll go when it's back."), with **Send now**; it goes when the node answers, at once when the browser is back online. A moment after you stop, a plain picture of the board (flat slate, solid chalk, 1280 × 720) goes to the node for the models that can see. What Galahad writes appears live (the world's stream says when the board changes). Keys on the board: `Z` / `Shift Z` (or `Ctrl Z` / `Ctrl Y`) undo and redo, `E` the duster, `1`–`6` the chalks, `0` fits, `+` and `−` zoom, Space and drag pans. A device paired without `chat` reads the board and says why it can't draw.
- **Projects** (under the main group, `G` then `P`) lists projects as cards (name, first line of the instructions, repository, chat count). A project's page has **New chat**, **Edit** (name, instructions in plain words or Markdown, repository; the id follows the name) and **Remove**, then its instructions, its chats and what was remembered in it.
- **Bank** (under Keys, `G` then `B`) shows the bank connection: connected or not, the consent left on a meter with the date it ends, **Connect** / **Re-authorize** (confirmed first, with a note to use the paired Safari, not the Home Screen app) and **Disconnect**. Each account shows its name, its IBAN masked to the last four, its currency, its bank fetches left today and the cache's age. **Agents that may read it** has a switch per agent. Balances and transactions aren't shown here: agents you allow read them. The bank's return (`/bank/callback`) opens the app, which takes the code out of the address bar and finishes the connection on this page.
- **Sandboxes** (a node without Docker says so and still lists the fleet's sandbox hosts; what each network boundary means folds into one line under the list, the create form explaining the one you pick) show how each sandbox is isolated (a green **microVM** badge, or a quieter "container"), its disk use against its limit as a meter (amber from 85 %), or a "no disk limit" badge with one callout per host that can't limit disk. Running sandboxes offer **Keep work…** (a folder under `/work`, by default `/work/out`). Lab sandboxes carry a "Lab" chip, and the create form chooses Workshop or Lab. The create form has a disk size and an **Isolation** choice: Automatic (it says what it will pick on that host: online gets its own microVM where it can), Container, or MicroVM, disabled with a reason on hosts without microVMs. Fleet cards show a "microVMs" chip on hosts that have them.
- **Autonomy view:** what Galahad may do alone (read; create and modify, logged), what asks (outward, delete) and what's denied (forbidden), with the last 24 hours' counts once the ledger exists. It sits on Overview and Activity.
- **Everything is visible:** the Activity timeline lists every classified action with its verdict and reason, grouped by day. One row above it: a search that finds anything a row shows (the node, the quest, the kind, the verdict, the details) and one **Filter** selector (the kinds of action as toggles with their counts, one verdict, *Show everything*). A refresh that brings nothing new leaves the list, opened details and focus exactly as they were.
- **Models** lists the roster as one row per role: what it's for, the model that answers first and how many fallbacks follow. **Change** opens the role's models in a sheet (reorder, remove, add from known models, Save). Providers follow.
- **Agents** (on Fleet) lists the coding agents that hold their own key to Galahad (MCP arms) with what each may do; **Revoke** cuts one off at once (type its name to confirm), from any device. Giving an agent a key, like raising a device's permissions, stays at a terminal on a node.
- **Permissions in the UI, not in settings:** Settings shows this device's scopes as granted or not; invites let you choose what a new phone may do (Everything / Chat & read / Custom); pages explain why an action is missing instead of failing.
- **Undo where possible:** clearing a conversation offers Undo. Irreversible actions confirm instead.
- **Placement playground:** "Where would this run?" ranks machines for a described piece of work, with reasons and rejections, and runs nothing.

## Safety patterns

These are enforced in code and, where possible, in tests (`packages/node/test/assets.test.ts`, `apps/web/src/lib/lib.test.ts`).

1. **No HTML from strings.** Everything is built with `createElement` / `createElementNS` / `textContent`. There is no helper that accepts HTML, and the build test fails if `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `createContextualFragment` appear in a bundle. Model output goes through a parser that emits an AST; raw HTML stays literal text.
2. **Links from models** are only ever `http(s)`, open in a new tab with `noopener noreferrer nofollow`, and carry the full URL as a tooltip. The real host is shown next to the link unless its text is itself a URL on that same host, so look-alike text can't disguise where it goes. Link text never contains another link. Images are never fetched (`img-src 'self' data:`).
3. **Keys** are typed or pasted only into `secretInput()`: `type=password`, `autocomplete=off`, `spellcheck=false`, no autocapitalise, password-manager opt-outs, and the browser's own reveal button hidden. The value is read once on submit and the field is cleared immediately, including on errors and when the sheet closes. It is never stored, logged or shown again; only the server's hint (`…3456`) is displayed.
4. **Secrets stopped at the door.** Chat and memory run `findSecrets` while you type and again at the moment of sending. A finding blocks sending and offers **Store it in the vault instead** (moves the detected key into the vault form and clears the message) or **Remove it from my message**. A chat draft is kept in memory between pages only when it has nothing secret-shaped in it. The server's 422 is shown as the same calm warning.
5. **Pairing:** a key store that can't be read just now (Safari drops its storage connection after a Home Screen app has slept) is tried again and then shown as exactly that, with Reload; never as "not paired", which would invite pairing a new key over the enrolled one. The SAS is shown large; the invite proof never leaves the page; requests go to `location.origin` only; the server's SAS and the approval proof are verified before the device trusts anything. Pairing survives a reload (phones discard tabs while you walk to the laptop): on load the page asks, with its status proof, whether it already asked or was approved, and network hiccups retry. The `#pair=` hash is cleared as soon as pairing ends, whether it succeeded or not. The pairing code (with the invite schema) is its own bundle, `/pair.js`, loaded only when an invite link is opened.
6. **Typed confirmation** for the most dangerous actions: revoking a device and deleting a secret. A plain confirmation for rotating the vault, destroying a sandbox, forgetting a memory, removing a provider and forgetting this browser. Approving a *machine* asks once more, because it receives the vault.
7. **Scope-aware:** destinations and actions follow `whoami.scopes`. Missing permissions are explained, not hidden behind errors.
   - A refused request isn't taken as proof of revocation. The app asks once more, and if the node's clock disagrees with this device's by more than a minute it says so ("This device's clock is off") instead of suggesting you forget a perfectly good key. When it does leave the app, polling and shortcuts stop with it.
8. **Storage:** `localStorage` holds UI preferences only (`galahad:theme`, `galahad:motion`, `galahad:sidebar`, `galahad:last-route`, `galahad:chat-role`). The device key is a non-extractable WebCrypto key in IndexedDB. Chats aren't kept on the device: the node keeps them (privately, deletable), and a temporary chat lives only in the tab. Settings lists all of this under *Kept on this device*.
9. **CSP-clean:** no inline scripts or handlers, no external origins; inline styles only (allowed by `style-src 'unsafe-inline'`), and only with constant or numeric values.

## Accessibility

- AA contrast throughout (see Tokens); visible 2 px focus rings (`--focus`) on everything focusable.
- Full keyboard use: palette, shortcuts, arrow keys in segmented controls, the palette and smart selectors (ArrowDown on a selector opens it; typing filters or jumps), Enter/Esc in dialogs, Up/Down history in the sandbox console.
- Dialogs use `showModal()`, label themselves and return focus to where you were.
- Chat has one persistent live region: it says when Galahad starts answering and reads the answer once it's complete (never token by token). Lists that refresh in the background (the ledger, fleet health) are not live regions, and background refreshes keep keyboard focus and opened sections where they were. Toasts announce through polite or assertive live regions. Counts, meters and the SAS code have text alternatives.
- Icons are decorative (`aria-hidden`) unless they carry meaning alone, in which case they get a label. Segmented controls keep an accessible name even when a phone hides their text.
- 44 px targets on touch screens; inputs at 16 px on phones.

## Keyboard

| Keys | Action |
|---|---|
| ⌘K / Ctrl+K, `/` | Search and commands |
| `G` then `O I C X D P J M A R W K E T F S V L B N ,` | Go to Overview, Inbox, Chat, SANDBOX, Chalkboard, Projects, Journal, Memory, Activity, Loops, Artifacts, Archive, Findings, Trials, Fleet, Sandboxes, Vault, Models, Bank, Connectors, Settings |
| `[` | Collapse or expand the sidebar |
| `?` | Show shortcuts |
| Enter / Shift+Enter | Send / new line (chat) |
| Esc | Stop the answer; close a dialog |

## Bundles

| File | What | Loaded |
|---|---|---|
| `/boot.js` | Theme and motion before first paint (~0.3 KB) | Always, blocking, in `<head>` |
| `/app.js` | The app (~338 KB; ~103 KB as brotli). Script is a small part of a phone's work (style and layout weigh more), so views aren't split out of it | Always; cached by the service worker |
| `/pair.js` | The pairing flow with the invite schema (zod) | Only when a `#pair=` link is opened |
| `/sw.js` | Offline shell, stale-while-revalidate | Registered on first visit |

Every text file (the page, the scripts, the manifest, the SVG icons) is sent with brotli (quality 9) or gzip when the browser accepts it, compressed on its first request and kept, and carries an `ETag`. Everything but the robots' versioned files is `no-cache` ("ask first"), so a browser or the service worker that already holds this version gets a `304` and no body: opening the installed app costs a revalidation, not the whole app again.

The PWA imports only what it needs from `@galahad/core` through subpath exports (`/bytes`, `/identity`, `/pairing`, `/request-auth`, `/secret-scan`), which keeps zod out of daily use.

## Code map

| Path | Owns |
|---|---|
| `index.html` | Tokens and all CSS |
| `boot.ts`, `prefs.ts` | Preferences before paint; the only localStorage access |
| `app.ts`, `shell.ts`, `live.ts`, `screens.ts` | Boot, the shell (routes, nav, palette commands, shortcuts), live polling, full-screen states |
| `pair.ts` | The pairing flow (its own bundle) |
| `ui/` | `dom` (element builder, `Scope` lifetimes), `icons`, `controls`, `dialog`, `palette`, `selector`, `toast`, `markdown`, `signal` |
| `lib/` | Pure, unit-tested logic: markdown parser, fuzzy search, time, text helpers |
| `views/` | One file per destination |

## Inspirations

- Karri Saarinen and the Linear team, on a calm interface where colour is earned: [Behind the latest design refresh](https://linear.app/blog/behind-the-latest-design-refresh), [How we redesigned the Linear UI](https://linear.app/blog/how-we-redesigned-the-linear-ui).
- Rauno Freiberg, [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design): interruptible motion, gestures that follow the finger, follow-through.
- Emil Kowalski (Sonner, Vaul): animation justified by frequency, fast ease-out, stacked toasts, draggable bottom sheets.
- Smashing Magazine, [Designing For Agentic AI: Practical UX Patterns For Control, Consent, And Accountability](https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) (Feb 2026): approvals that scale with stakes, process views, a visible Stop, visible permissions and activity, an autonomy view.
- Galahad's own [Oath](OATH.md): the autonomy classes, "creating is free; deleting asks", and how keys are handled.
