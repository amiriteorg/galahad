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

### The mark: the helm

**Galahad's helm as the owner drew it: a white great helm, his oxblood cross down its face and across its brow, his eyes in the dark slit behind the cross's arm.** The mark is the drawing itself, cut out of its paper along the helm's own bottom edge (`apps/web/src/knights/galahad-helm.webp`), the same drawing Galahad is in the roster. Where a mark must be one flat colour (the icon set at 16–24 px, the flat file) it is the helm's silhouette, traced from the same drawing, with the cross and the slit cut out of it (`MARK_PATH` in `apps/web/src/brand.ts`).

| File | Use |
|---|---|
| `assets/icon.svg` | App icon and favicon: the drawn helm on a black tile |
| `apps/web/src/icon-maskable.svg` | Full bleed for platform masks (`purpose: maskable`); the helm sits inside the central safe circle |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Raster icons for iOS and launchers that won't take SVG, rendered from the full-size cut-out (`apps/web/design/galahad-helm.webp`) |
| `assets/galahad-mark.svg` | The flat mark in `currentColor`: the silhouette, the cross and the slit holes in it |
| `apps/site/public/crest-{white,black}.svg` | The drawn helm, for the site's header and crest (it reads on a light page and a dark one) |
| `ui/emblem.ts` → `emblem()` | The drawn helm inline in the PWA, on no tile: its own ink line holds it in either theme; the boot screen shows it too |
| `icon("mark")` | The flat silhouette on the 24 px grid, for menus and the tab bar (Galahad's voice: chat, requests, trust) |

Regenerate with `bun scripts/brand.ts` (SVGs) or `bun scripts/brand.ts --png` (also the PNGs, rendered by headless Chromium). Tests pin the silhouette to the icon grid, the icons' tile and safe zone, that the SVGs carry the helm the app serves and fetch nothing, and that no committed file drifts.

- Keep clear space of at least a quarter of the helm's width. Don't recolour the drawing, add effects, or put it on a busy image. Below 20 px use the flat mark.

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
- Headings tighten (−0.01 to −0.022em); small caps-style group labels (11 px, uppercase, +0.06em) are used only in the palette and the smart selector's groups.

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

- **One roster, everywhere: the Roundtable.** The app's home is one roster (`views/roster.ts`, its rows from `lib/roster.ts`): **Galahad** first, as your primary knight and first among equals, then every other knight in the node's order, then the rooms, the latest spoken in first. Each row is a face, a name, **one line** of what it is doing now (the running task and the step it is at, a reply being written, what its work waits for, how its last task ended, the last thing said where the app has read it, or else its job) and an amber **mark** when it needs you (an approval it asked for, work that failed or was interrupted, work waiting behind a pause). What needs you that is no other knight's (devices asking to join, keys he asked for, his own approvals, notices) is marked on Galahad's row. The rows are worked out from what the app already asks (the team's one snapshot, the Inbox, the work in hand): nothing is asked for per row. Beside the roster there is one more entry, **More**, a plain index page (`#/more`) of everything else under five headings, each place with a line saying what is there: *Work* (Inbox, Overview, Projects, Loops, Activity, Artifacts, Trials), *Knowledge* (Memory, Skills, Archive, Findings), *Machines* (Fleet, Sandboxes), *Keys and models* (Vault, Models, Connectors, Bank) and *This device* (Settings). A place reached from More keeps More marked. The Inbox is one tap from Galahad's header, and on More. The places are one list, `lib/nav.ts`: an address is a contract (none is renamed or dropped), and a device sees the places its scopes allow; a test holds both. `#/roundtable` is the Roundtable's second address (`#/team` stays its own); the Work tab's old address (`#/team?room=…&tab=work`) opens the timeline, and `&tab=workspace` a knight's Workspace panel.
- **Desktop (≥ 960 px):** the roster is the sidebar, under the wordmark and search (⌘K / Ctrl+K), with More and this device (it opens Settings) at its foot; the main pane is the open timeline (Galahad's at `#/chat`, a knight's or a room's at `#/team?room=…`) or a page from More. The app opens on Galahad's timeline, beside the roster; `#/team` alone shows the Roundtable's own page (give a task, seat a knight, make a room). The sidebar collapses to faces (`[`); the choice is remembered. While Galahad answers, his row carries Stop. The top bar, on pages, carries the fleet status pill and an "Answering… Stop" pill.
- **Phones:** the roster is the first screen (`#/team`), under the wordmark and search, with a bottom bar of two entries: the **Roundtable** (counting what waits in the Inbox) and **More** (a device that may not chat has its Inbox and More, and opens on its Inbox). A row opens its timeline as the whole screen, with no top bar and no bottom bar, and a way back to the roster at its left. Pages from More have the glassy top bar with the mark. Safe-area insets are honoured everywhere. The installed iPhone app uses the **default** (opaque) status bar, not `black-translucent`: under a translucent one, iOS 26 draws its own blur (26.1+: a scrim) over the top of the app that no page can turn off; with the default style the status bar is painted in the page's colour (`theme-color` is exactly `--bg`) and the app starts below it. iOS stores the style when the app is added, so an install from before this change must be removed and added again (and paired again: a Home Screen app's storage goes with it).
- **A timeline has no top bar.** Its header is whose it is: Galahad himself (see *Chat's header and history*), a knight (its face, its role and what it is doing, and **Workspace**), or a room (its members, its settings, Pause and Stop), on the same glass ground across the page's width, and it stays at the top while the timeline scrolls under it.
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
| Stat tile, meter, timeline | `controls.ts`, `views/activity.ts` | Figures in tabular numerals; meters turn amber past 85–90%. |
| Avatar | `ui/avatar.ts` `workerAvatar()` | One of the owner's ten drawings of knights (`apps/web/src/knights/`), the drawing itself cut out of its paper, every one on the same square canvas with its feet on one baseline, and live eyes drawn over the drawn ones. Which drawing a knight is, core's `avatarLook` says (a look chosen for it; else the drawing its name is; else one from its handle). What it is doing is the node's word on its work (`avatarExpression` in `@galahad/core/avatar`, from the mark that starts its task's latest line), never a mood, shown with its eyes: up while it thinks, down at the work, along the lines, after the pointer, back and forth while its gates run, up and away while it waits; wide with a red mark beside it when it asks your leave, happy after a pass, lowered after a failure, shut (its colour drained) while paused. The motion is CSS the first avatar gives the page (`KNIGHT_CSS`); a speaker beside something it said earlier stays still, and nothing moves under reduced motion. Each is named for a screen reader ("Percival · working"; "Percival's avatar" beside something it said earlier). Galahad is his own drawing with his red cross, and in beast mode the Black Knight, eyes burning red (`beast`). `apps/web/design/avatars.html` (written by `bun apps/web/design/avatars.ts`, not served) shows every drawing and state; `apps/web/design/knights-cutout.py` is how a drawing is cut out. |

## Smart selector

Where a view had a cluster of controls (role buttons, toggles, rows of filter chips), it now has **one control that says what's chosen in plain words** and opens the choices. Rarely changed options live inside it; nothing used often gets harder to reach (Chats and New chat stay buttons beside it).

- **The control** (`.selector-trigger`): an optional icon or status dot, the current choice in words (ellipsised, the full text in its name and tooltip), a chevron. A non-default choice, such as a filter that's on, is shown in ink (`data-active`). `icon-only` makes a ⋯ menu of it.
- **The choices**: a popover anchored under the control (above it when there's more room there); a bottom sheet on narrow screens (under 640 px) with thumb-sized rows (48 px) where the pointer is coarse, where the keyboard waits until you tap the search field. Groups have small-caps labels and choose **one** (a check), toggle **many** (a box) or run an **action**. Options carry an icon, a meta line (a model, a count, what it means), a status dot, or the reason they can't be chosen.
- **Finding**: a search field past seven options (fuzzy, by label, meta and keywords; matches marked in ink; each new query makes its best match the one Enter chooses); without one, typing jumps to the option that starts with it. The likely choices come first: the caller orders them (projects by last use).
- **Keys**: ArrowDown on the control opens it; arrows move and skip what can't be chosen; Enter (or Space in the list) chooses; Esc closes and focus goes back to the control. Choosing one closes at once; toggles stay open.
- **Using it**: `selector({ label, current: () => "…" | { text, icon, tone, active }, groups: () => [...], onSelect: (group, option) => { change state; } , scope })` returns `{ el, refresh, open, close }`. `groups()` and `current()` are read every time they're shown, so the control always tells the truth; call `refresh()` after a change from elsewhere.
- **Where**: the chat's one ⋯ menu, the Activity filter, the Archive's kind, time and trust.

## Agentic patterns

- **Process view, not a spinner.** Each answer shows its steps as they happen: *Asked as planner* → *Read 3 archived entries* (which ones, by id and title, untrusted ones marked; only when the archive had something relevant) → *Thinking with anthropic/claude-opus-5-5* → (*… didn't answer: reason*, on fallback) → each tool Galahad uses, with its icon, its title and arguments, and how it went (*Bank balances* `{"account":"…"}` → *data*; a refused or failed call is amber) → *Answering*. When it's done, the steps fold into one line (`planner · model · 4.2 s · 2 tools · 1 fallback`) that you can open again.
- **Stop is always one click away:** while he works the composer shows Stop, Esc stops, and from any other page the top bar shows "Answering… Stop". Stop is said to the node, and it is the only thing that stops him: the turn runs there, so it goes on while you look elsewhere, lock the phone or reload, and the page that comes back (or another device) shows it from its start. Enter never stops an answer.
- **A knight is one timeline** (`views/team.ts`, `lib/timeline.ts`): its own conversation with you and every task given to it, wherever it was given, in the order they happened; a room's timeline holds the room's words and tasks. A task is a **card** where it was given, and it stays there while it runs and after (`views/task-card.ts`, its words in `lib/task-card.ts`): its title and a badge (Queued; Running, in ink; Verified, green; Not verified, amber; Failed, red; Stopped; Interrupted, amber), then who gave it to the Roundtable when it wasn't given by name, the room it was given in when that was another, and what it waits for.
  - **While it runs**, its latest six lines in mono, the newest in full ink. They are asked of the node only for what is new (`POST /api/team/trail` with `after`), every 1.5 s while the card is on screen and the app is in front, and never once the task has ended. They are a log that is not read aloud as it grows.
  - **Once it has ended**: why it wasn't verified, a quest's own ending in words ("It gave up.") in a callout (red for a failure, amber for an interruption, quiet for a stop of yours); what the knight said of it (its own summary, four lines at most); what its run came to (`taskRecordFacts`, the terminal's words); the files its changes kept and the artifact that holds them (it opens in Artifacts); and, folded, *What it did* (everything the node kept of its lines, read when it is opened) and *The task* (goal, commands, result).
  - Work in hand can be **stopped**; work that ended unverified can be **resumed**, or **given again** as an editable copy of what was asked; verified work has nothing to press. Items that haven't changed are handed back as they are (`ui/dom.ts`' `syncChildren`), so a running trail and an opened disclosure survive the 2 s refresh.
  - The **composer** messages the knight; **Give a task**, beside Send, gives it one: a goal, the commands that prove it, what to wait for. While it is busy, what you send waits ("Ada replies when free").
- **Give a task to the Roundtable.** The Roundtable is a technocracy: the knight best suited to a task takes it. **Give a task** sits in the roster's Roundtable row (and on the Roundtable's own page, and in the palette): one sheet with the goal, an optional title, the commands that prove it, and *Who takes it*, which is the Roundtable by default and each knight by name beside it. For the Roundtable's choice it asks what the task needs of a knight (a desktop, a repository). The answer replaces the form: "Gawain takes it", the node's reasons in a line, then how each of the others stood, those that couldn't saying why; **Open Gawain** goes to its timeline, where the card says it was given to the Roundtable. A task none can take is refused in the node's words, in the sheet.
- **A knight's Workspace** is a panel opened from its header (`tab=workspace`), not a tab: its desktop first when it has one (below), then the knight (Edit, Pause, Working notes, Remove), its VM (status, MicroVM, **Desktop** or *No desktop*, where and how big; Open terminal where the VM is on the node you talk to, else Open console; Check status, Make VM again), harness readiness and the notes store. Provisioning a VM and making it again each carry a **Desktop** choice (the desktop image, about 1.1 GB more, at least 4 GB of memory).
- **Watching a knight's desktop, and taking it over** (`views/desktop.ts`, `lib/desktop.ts`). When the VM is made from the desktop image and running, its screen is a picture, asked for about every two seconds while it is in view and the app is in front, one request at a time; "Seen just now · 1280×800" says how fresh it is. Its box takes the screen's own proportions, so a click on it (a crosshair says it is one) clicks at that place on the knight's screen, whatever size the picture is drawn at; a line under it says it acts at once, even while the knight works. Return, Tab, Escape, Backspace, Scroll up and Scroll down are a press each; an address opens in its browser; a text field types (a switch hides what you type, for a password), and a line says that typed text is never written to the ledger. Each thing done brings back the screen as it then is. When the VM says it has no desktop (a 424), the looking stops and **Make VM again with a desktop** is offered; any other refusal is said once, with **Try again**. Nothing on it moves but the picture.
- **Steer or queue.** While he works, a message either **steers** (he's told at his next safe point; a tool that's running finishes first) or is **queued** (kept on the node, sent when he's done). What Enter does is this device's choice (Settings → Chat; steer by default), Ctrl or ⌘ with Enter does the other, and each has its own button beside Stop (the way on a phone); the one Enter does is in ink, and the line under the composer says what the keys do now. In a temporary chat there's nowhere to keep a message, so both steer. Above the composer, one panel holds what's waiting: steers on their way to him, then the queue (each message with **Send now**, Edit and Remove), and one line that says what unattended work may do ("He keeps working if you leave this page, and stops by itself in 27 min. Anything that needs you (an approval, a key) waits in your Inbox: nothing is approved for you."). After a Stop, a failure or a restart the queue is **held** and says why, with **Resume** and **Discard**. A steered answer keeps what he'd said and says "Steered here"; your message follows it in the thread.
- **Ask on the side.** *Ask on the side…* in the chat's ⋯ menu, or `/btw …` typed into the composer, asks something about the work in hand without changing its course: a sheet shows the answer apart (from the chat and what he's done so far in this turn, without his tools), and **Bring back** hands it to him after all (it steers him, or joins the chat when he isn't working).
- **In hand** (a tap on Galahad in the chat's header opens it as a sheet, with what needs you above it and a way to the Overview below; it is also first on the Overview, only when there is something): the chat turns the node is running (what each is at, how long, how many tools, whether anyone is watching, when it stops by itself; Open and Stop), then each quest in hand as a card: its goal and state, the command he's on of how many, what he's doing now, each gate as a badge (passed, failed with its exit code, not run yet) with its command and whose it is ("yours", "proposed by the planner"; a failed gate's output one click away), and the plan folded under it. Quests that ended lately follow, with how (only a reviewed one is green).
- **Notifications** (Settings): he comes to you, and the page says exactly what that means before it asks for anything. One switch, **Notifications on this device**, whose line under it is the state in plain words: off ("Your browser asks you once, when you turn this on"), on (through which push service, since when), blocked (the browser said no: where to allow it), an iPhone or iPad not yet on the Home Screen (how to put it there), or a browser that can't. The browser's permission prompt is raised only by that tap, never by opening a page. Beside it, always: what a notification holds and what it never does (a key, the bank, a model's own words). **Send a test** appears once it's on. Below, the node's own settings, the same from every device: a switch per kind with what it means, quiet hours (a switch and two times, with the sentence they make), and the day's limit with today's count. The lock-screen text is the node's, never markup; a tap opens the app at the Inbox, the chat or the Overview, in the window that's already open.
- **Doctor** (on Overview, for a device that may administer the fleet): is everything well on the node you're talking to. It opens with a quick look that costs nothing and says the verdict in one line beside a status dot ("All is well: 31 checks passed", or "1 broken, 2 need you; 28 well"), then lists only what isn't ok, broken first, each with a badge (Needs you in amber, Broken in red), the line and what to do under it. Every other line is one click away ("All 33 lines"), grouped as a terminal lists them, each with a small dot. **Full check** is yours to press, never done because a page opened: it asks each role's model one word and starts a sandbox, and the card says so before and while it runs. The lines are the node's own words, set with `textContent`; the page reads the report at its boundary and leaves out what it can't draw.
- **The Inbox** gathers everything that needs you: **oath approvals** first (what an agent or a loop wants to send or delete: the exact request, who asked, why, the arguments and the time left; Decline is one click, Approve confirms what will be sent once, and a delete makes you type what it deletes; **Approve and allow similar…** approves it and signs a standing order in one step, with each argument set to Exactly, Pattern or Any, who may use it, how long it lasts and a plain-words preview of what it will let through), then devices asking to join (with their code), credentials Galahad asked for (with an inline sealed field), and the **notices** the heartbeat and loops raise (Dismiss keeps one quiet until it changes). A collapsed list shows recent decisions and their receipts, and names the standing order that answered a request when one did. New pairing requests and new approvals raise a toast with **Review**; the Inbox badge counts all of it.
- **Loops** lists the work Galahad does on a schedule: the schedule in words with its time zone and node, next run, the last run's status and first line, Run now, Pause/Resume, Change, Remove and recent runs. *Check now* runs the heartbeat's checks on the spot. The add/change dialog offers schedule presets with a live preview and the three tasks (heartbeat with a checklist, quest with its optional gates, one shell command a line: "done means these pass", connector call with typed fields). A loop whose task this version no longer has says so in a warning, and can be removed. Above the list, **Self-action**: one switch ("Galahad fixes what's safe himself", on by default; its hint names the heartbeats it follows and what always waits for you), the allowlist in plain words, each kind with its oath class, and his latest fixes.
- **The Inbox** also has, collapsed under the decisions, **Fixed by Galahad himself**: "Galahad fixed: …" (or "Galahad tried: …" when it didn't work), with what it was about and when, and a line pointing to the switch.
- **Connectors** shows the installed and available connectors with the origin each is pinned to, its key state in plain words, a sealed key field, and its tools with their oath class (outward and delete say they ask you).
  - **Standing orders** come first: each order's tool, its constraints in plain words ("starts with feat/", "any"), who may use it, its expiry and use count, and Revoke. A stale order (its tool changed since you signed) says so and why; expired and revoked ones fold away. A tool row with an active order carries a badge.
  - **Add an MCP server** takes the server's address, an id and whether it needs a key (the sealed key field appears in the same dialog). The tools it lists show the server's claim and its description quoted as the server's words (data, never instructions), with a class picker that starts from the proposed class. Making a tool run unasked is confirmed first. MCP cards add **Refresh tools**, which shows what's new, changed and gone.
- **Artifacts** (under More, `G` then `W`) lists what quests and sandboxes kept. An artifact's files show their size and short SHA-256; text previews in monospace (Markdown rendered, HTML and SVG only as source), raster images inline. Every fetched file is checked against its recorded hash with WebCrypto, with a clear warning on a mismatch; downloads are always saved, never opened in the app; "Download all" builds one `.tar` in the browser; removing kept work makes you type its name.
- **Inbox** action cards that would send kept work (a shipment) carry **Read the changes**, which opens the artifact (`changes.patch` previews as text, every file with its SHA-256); long arguments such as a pull request's body are clipped on the card.
- **Archive** (under More, `G` then `K`; the library icon) is everything kept for good on the node you talk to, searched by words and meaning together. One row on top: the search box ("Search the archive by words or meaning") and one **smart selector** for kind (Models, Teachings, Ideas, Artifacts, Chats, Lessons and any other kind the archive holds, as toggles with their counts), when it was made (Any time, Today, This week, This month, This year) and whose words (Yours, Galahad's, Untrusted, toned like trust everywhere), which says what's on in plain words ("Ideas, models · this week · yours"). With no words, the newest entries; with words, the fused results, each with its kind's icon, its trust badge, its summary (or its best passage), when it was made, which file the passage is from and how it was found ("text + meaning 0.82"). Beside the list, the index's state as a card: entries by kind, passages embedded (a meter) and waiting, the embedder in words with a status dot (green on this machine, amber when it's remote, since passages then go to it, or failing), summaries used today of the budget (Change, for `brain:write`; "a local model only, until you set a budget"), the last integrity check, disk used, and each source's last pull; **Check the files now** and **Embed again** for your devices. Opening an entry shows its kind and trust, an amber note when others wrote it, the summary, facts, lessons (what worked, what failed, what to try next), its description, its files (View and Save, each checked against its SHA-256 in the browser, HTML and SVG only as source), what it links to (each opens), and what was kept out (a redacted secret, a refused key file). **Delete…** asks for a reason and makes you type its name. **New idea** (the page's one primary action, and in the palette) takes a title, details and tags, and stops anything secret-shaped before it's sent.
- **Skills** (under More, `G` then `U`; the scroll icon; `#/skills`) is what he learned, as pages of notes. A reading page (760 px). First, **Waiting for you**: each skill or new version that needs your answer as a card with its whole text (when to use it, numbered steps, each proof as a command in a sunken mono block with what to expect under it, pitfalls), then **Where it came from** as a sentence in the node's own words (who wrote it, from which quest, and why it's untrusted), its trust badge and what that trust means for whether he's given it. Approve is the one primary action on the card and asks once more, restating where it came from and that an approved skill is still data; beside it Retire (a new skill) or Decline it (a new version of a skill in use, which stays in use until you decide). Then **In use**: rows with the title, when to use it (two lines at most), state, trust and lock badges and the track record in words ("used in 3 quests: 2 passed review, 1 didn't"); a row opens the skill as a sheet titled by it, with its words, its origin, the quests that used it (each with how it ended), every version (none is ever deleted) and, in the sheet's footer, Edit, Roll back one version, Lock / Unlock and Retire. **Retired** ones are folded away in a disclosure. Above it all, the day's budget for distilling in a line, with Change. **Write a skill** opens plain fields (title, when, steps one a line, proofs as `command => what to expect`, pitfalls); what's wrong is said beside Save with the field marked, and anything secret-shaped is stopped before it's sent. Green means in use, amber means it waits for you or is untrusted; nothing else is coloured. Every word of a skill is a text node, whatever it says.
- **Findings** (under More, `G` then `E`) lists what investigations concluded, each with a Supported / Refuted / Inconclusive badge and how many of its predictions held. Opening one shows the pre-registration exactly as recorded before anything ran (hypothesis, the alternative, each prediction with what would refute it, how the instruments were checked, the decision rule) beside what was found for each prediction, the summary, the reviewer's judgement of the method, and **Open the evidence** (its artifact).
- **Trials** (under More, `G` then `T`) shows whether Galahad is getting better. Three tiles for the latest run (the Galahad Index with its 90 % interval, how many were solved outright, the revision and models), then every run as a row with its Index on a meter, and each problem over every run. Opening a trial shows each answer beside the exact one with its tolerance and how far off it was ("within 0.05 %", "off by 12 %"), the seed that poses it again, the quest's outcome, and **Open its work**. The Index is computed by the same function as the CLI (`@galahad/core/galahad-index`, no dependencies). Runs start from a terminal, so an empty page shows the command to copy.
- **Chat's header and history.** A chat is kept from its first answer, on the node you talk to. Galahad's row on the roster opens his most recent conversation: the one you had open, or with none remembered the latest one kept. The header is one row (on a phone, after a way back to the roster):
  - **Galahad**: his face, and under his name one line of what he is doing now, from what the app already asks the node (`lib/now.ts`). While he writes the answer on screen it is the step he is at ("Thinking with anthropic/claude-opus-5-5"); otherwise what he has in hand ("Working in “Release plan”", "Working on: …" for a quest, "Working on 3 things"); then how much waits in the Inbox ("· 1 thing needs you", and the line turns amber); with nothing of either, "Idle · nothing needs you". The work comes first, because a phone cuts the line's end and the Inbox's badge still counts what needs you. His expression follows the same word: eyes up while he writes an answer, three dots while work is in hand, flat eyes while something waits for you. Beside his name is the model that answers, and the role when it isn't the planner. A tap on him opens what he has in hand. The quests in hand are asked for every 15 s while the chat is on screen; nothing else is asked that wasn't already.
  - The **Inbox**, one tap away, counting what waits for you that is no other knight's.
  - One **⋯** menu: **New chat** and **All chats…** (a sheet with search and the chats grouped Pinned / Today / Yesterday / This week / Earlier, each with its project, message count and age) come first; then, for everything changed rarely, for the chat itself *Ask on the side…*, Rename, Pin and Delete (confirmed: deleted for good on the node); *Who answers* (each role with its first model and fallbacks; a role with no model, or the decider, which answers typed decisions, can't be chosen and says why); *Project* (a new chat starts in one, the ones you used last first; a kept chat moves to one) and *Temporary chat* (not kept).

  An open chat shows, under the header, its title (tap to rename; a pin when pinned), its project chip and a *bank* badge when Galahad read the bank in it; a temporary chat says that it isn't kept. A kept answer comes back with its steps, tools included. Every chat in a list carries where it stands, when that's worth saying: *Working* (with a spinner), *Needs you: an approval* (or a key, or an answer), *2 queued* (amber when held, with why), *Stopped*, *Failed*; a chat that's simply done says nothing. A new chat's empty screen opens at the top with four one-line suggestions (each puts its whole question in the box) and the four most recent chats (in its project, when it has one). After a reload the app comes back to the chat you had open. An answer cut off by a dropped connection says so ("The connection to … dropped while Galahad was answering. Retry asks again.").
- **Projects** (under More, `G` then `P`) lists projects as cards (name, first line of the instructions, repository, chat count). A project's page has **New chat**, **Edit** (name, instructions in plain words or Markdown, repository; the id follows the name) and **Remove**, then its instructions, its chats and what was remembered in it.
- **Bank** (under More, `G` then `B`) shows the bank connection: connected or not, the consent left on a meter with the date it ends, **Connect** / **Re-authorize** (confirmed first, with a note to use the paired Safari, not the Home Screen app) and **Disconnect**. Each account shows its name, its IBAN masked to the last four, its currency, its bank fetches left today and the cache's age. **Agents that may read it** has a switch per agent. Balances and transactions aren't shown here: agents you allow read them. The bank's return (`/bank/callback`) opens the app, which takes the code out of the address bar and finishes the connection on this page.
- **Sandboxes** (a node without Docker says so and still lists the fleet's sandbox hosts; what each network boundary means folds into one line under the list, the create form explaining the one you pick) show how each sandbox is isolated (a green **microVM** badge, or a quieter "container"), its disk use against its limit as a meter (amber from 85 %), or a "no disk limit" badge with one callout per host that can't limit disk. Running sandboxes offer **Keep work…** (a folder under `/work`, by default `/work/out`). Lab sandboxes carry a "Lab" chip, and the create form chooses Workshop or Lab. The create form has a disk size and an **Isolation** choice: Automatic (it says what it will pick on that host: online gets its own microVM where it can), Container, or MicroVM, disabled with a reason on hosts without microVMs. Fleet cards show a "microVMs" chip on hosts that have them.
- **Autonomy view:** what Galahad may do alone (read; create and modify, logged), what asks (outward, delete) and what's denied (forbidden), with the last 24 hours' counts once the ledger exists. It sits on Overview and Activity.
- **Everything is visible:** the Activity timeline lists every classified action with its verdict and reason, grouped by day. One row above it: a search that finds anything a row shows (the node, the quest, the kind, the verdict, the details) and one **Filter** selector (the kinds of action as toggles with their counts, one verdict, *Show everything*). A refresh that brings nothing new leaves the list, opened details and focus exactly as they were.
- **Models** lists the roster as one row per role: what it's for, the model that answers first and how many fallbacks follow. **Change** opens the role's models in a sheet (reorder, remove, add from known models, Save). Providers follow.
- **Compute** (on Fleet). Each node's card carries its capacity under the chips: **Strength** (what it measured, in cores' worth, with a chip for each thing measured: work at once, one thread, memory, disk, sandbox start-up, a local model; **Measure again** for devices that may), **Ceiling** (what he may use of the machine, and whose ceiling it is: yours, or "The default: half of the machine"; **Set ceiling** opens a sheet with two sliders and a sandboxes switch, saying what the default is and that a tenth of the threads stays the host's) and **Slots** (pips for a few slots, a count for many; "2 of 3 slots in use", an amber "1 waiting" badge, and each waiting sandbox with why). "Why these numbers" folds every reason behind one line and stays open across refreshes. A fourth stat tile gives the fleet's slots. The **Compute** section below has effort and the day's budget (**Change**), the quests in hand with their effort and each attempt ("Attempt 2 · at the forge · The engineer is thinking"), what more compute would buy, and his suggestions as quiet callouts. Nothing on the page buys, rents or installs anything, and it says so. On Trials, **By effort** shows the Index per effort level and a verdict callout: green only when more compute measurably helped.
- **Agents** (on Fleet) lists the coding agents that hold their own key to Galahad (MCP arms) with what each may do; **Revoke** cuts one off at once (type its name to confirm), from any device. Giving an agent a key, like raising a device's permissions, stays at a terminal on a node.
- **Permissions in the UI, not in settings:** Settings shows this device's scopes as granted or not; invites let you choose what a new phone may do (Everything / Chat & read / Custom); pages explain why an action is missing instead of failing.
- **Undo where possible:** clearing a conversation offers Undo. Irreversible actions confirm instead.
- **Placement playground:** "Where would this run?" ranks machines for a described piece of work, with reasons and rejections, and runs nothing.

## Safety patterns

These are enforced in code and, where possible, in tests (`packages/node/test/assets.test.ts`, `apps/web/src/lib/lib.test.ts`).

1. **No HTML from strings.** Everything is built with `createElement` / `createElementNS` / `textContent`. There is no helper that accepts HTML, and the build test fails if `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `createContextualFragment` appear in a bundle. Model output goes through a parser that emits an AST; raw HTML stays literal text.
2. **A knight's screen** is shown only as a JPEG or PNG in base64 from the node, as a `data:` image (`img-src 'self' data:`), never as anything else it might send. What you type on it goes to its VM when you send it and nowhere else: it is not kept in the page or as a draft, the field is emptied once it is sent, and the ledger records only how many characters.
3. **Links from models** are only ever `http(s)`, open in a new tab with `noopener noreferrer nofollow`, and carry the full URL as a tooltip. The real host is shown next to the link unless its text is itself a URL on that same host, so look-alike text can't disguise where it goes. Link text never contains another link. Images are never fetched (`img-src 'self' data:`).
4. **Keys** are typed or pasted only into `secretInput()`: `type=password`, `autocomplete=off`, `spellcheck=false`, no autocapitalise, password-manager opt-outs, and the browser's own reveal button hidden. The value is read once on submit and the field is cleared immediately, including on errors and when the sheet closes. It is never stored, logged or shown again; only the server's hint (`…3456`) is displayed.
5. **Secrets stopped at the door.** Chat and memory run `findSecrets` while you type and again at the moment of sending. A finding blocks sending and offers **Store it in the vault instead** (moves the detected key into the vault form and clears the message) or **Remove it from my message**. A chat draft is kept in memory between pages only when it has nothing secret-shaped in it. The server's 422 is shown as the same calm warning.
6. **Pairing:** a key store that can't be read just now (Safari drops its storage connection after a Home Screen app has slept) is tried again and then shown as exactly that, with Reload; never as "not paired", which would invite pairing a new key over the enrolled one. The SAS is shown large; the invite proof never leaves the page; requests go to `location.origin` only; the server's SAS and the approval proof are verified before the device trusts anything. Pairing survives a reload (phones discard tabs while you walk to the laptop): on load the page asks, with its status proof, whether it already asked or was approved, and network hiccups retry. The `#pair=` hash is cleared as soon as pairing ends, whether it succeeded or not. The pairing code (with the invite schema) is its own bundle, `/pair.js`, loaded only when an invite link is opened.
7. **Typed confirmation** for the most dangerous actions: revoking a device and deleting a secret. A plain confirmation for rotating the vault, destroying a sandbox, forgetting a memory, removing a provider and forgetting this browser. Approving a *machine* asks once more, because it receives the vault.
8. **Scope-aware:** destinations and actions follow `whoami.scopes`. Missing permissions are explained, not hidden behind errors.
   - A refused request isn't taken as proof of revocation. The app asks once more, and if the node's clock disagrees with this device's by more than a minute it says so ("This device's clock is off") instead of suggesting you forget a perfectly good key. When it does leave the app, polling and shortcuts stop with it.
9. **Storage:** `localStorage` holds UI preferences only (`galahad:theme`, `galahad:motion`, `galahad:sidebar`, `galahad:chat-role`, `galahad:chat-enter`: what Enter does while he works, and `galahad:open-chat`: the id of the kept chat you had open, never a word of it, so a reload comes back to it). The page you were last on isn't kept: the app opens on the Roundtable (on a wide screen, Galahad's timeline beside it), and an address survives a reload by itself. The device key is a non-extractable WebCrypto key in IndexedDB. Chats aren't kept on the device, nor is what you queued behind them: the node keeps them (privately, deletable), and a temporary chat lives only in the tab. `sessionStorage` isn't used at all (a test fails the build if it is). Settings lists all of this under *Kept on this device*.
10. **CSP-clean:** no inline scripts or handlers, no external origins; inline styles only (allowed by `style-src 'unsafe-inline'`), and only with constant or numeric values.

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
| `G` then `C H I .` | Go to Chat (Galahad's timeline), the Roundtable, Inbox, More |
| `G` then `O P R A W T M U K E F S V L N B ,` | Go to Overview, Projects, Loops, Activity, Artifacts, Trials, Memory, Skills, Archive, Findings, Fleet, Sandboxes, Vault, Models, Connectors, Bank, Settings |
| `[` | Collapse or expand the sidebar |
| `?` | Show shortcuts |
| Enter / Shift+Enter | Send / new line (chat) |
| Enter, Ctrl+Enter (⌘+Enter) while he works | Steer him now, or queue it for after: Enter does the one this device chose, the modifier the other |
| Esc | Stop him; close a dialog |

## Bundles

| File | What | Loaded |
|---|---|---|
| `/boot.js` | Theme and motion before first paint (~0.3 KB) | Always, blocking, in `<head>` |
| `/app.js` | The app (~480 KB; ~145 KB as brotli). Script is a small part of a phone's work (style and layout weigh more: measured below), so views aren't split out of it | Always; cached by the service worker |
| `/pair.js` | The pairing flow with the invite schema (zod) | Only when a `#pair=` link is opened |
| `/sw.js` | Offline shell, stale-while-revalidate | Registered on first visit |

Every text file (the page, the scripts, the manifest, the SVG icons) is sent with brotli (quality 9) or gzip when the browser accepts it, compressed on its first request and kept, and carries an `ETag`. Everything is `no-cache` ("ask first"), so a browser or the service worker that already holds this version gets a `304` and no body: opening the installed app costs a revalidation, not the whole app again.

The PWA imports only what it needs from `@galahad/core` through subpath exports (`/bytes`, `/identity`, `/pairing`, `/request-auth`, `/secret-scan`), which keeps zod out of daily use.

### What opening the app costs

`bun apps/web/measure/first-load.ts` measures it, and measures any checkout the same way (`--repo <checkout>`), so a change to the app is shown with its number before and after; `--shots <dir>` also takes screenshots at 390 and 1280 px, light and dark, at the same addresses on any checkout (`--runs 0` takes only those). It starts a throwaway node on loopback (a temp home, stand-in models, a stand-in Docker), gives it seven knights (one with a desktop in its VM), a room, tasks (running, waiting, verified with kept changes, given up) and two trial runs, a kept chat, a quest in hand and a key he asked for, pairs a headless Chrome through the real pairing page, and opens Chat, the Roundtable, a room, the Overview and a kept chat **cold** (nothing cached, no service worker: the first visit after pairing) and **warm** (the service worker holds the shell: every visit after that). It does so on the machine as it is ("laptop", 1280×800) and with the processor slowed 4× on a line of 9 Mbit/s down and 60 ms a request ("phone", 390×844: an emulation, not a phone). *Usable* is the first frame after the page's own content has replaced every loading placeholder (for a kept chat, once its answer is drawn).

On 14 November 2026, in Chrome 156 on the owner's Mac, the Roundtable against the app just before it (`b5a24e4`), one after the other in three rounds, the order swapped in the second; the third round (the median of nine loads, with the fastest and the slowest):

| Page · profile · visit | Before: usable | After: usable | Elements |
|---|---|---|---|
| Chat · laptop · cold | 65 ms (53–83) | 73 ms (60–90) | 329 → 369 |
| Roundtable · laptop · cold | 64 ms (48–68) | 67 ms (54–84) | 336 → 308 |
| Room · laptop · cold | 68 ms (59–90) | 78 ms (62–84) | 380 → 395 |
| Overview · laptop · cold | 71 ms (64–76) | 79 ms (70–101) | 737 → 799 |
| Kept chat · laptop · cold | 58 ms (52–77) | 62 ms (54–69) | 308 → 369 |
| Chat · phone · cold | 580 ms (575–588) | 574 ms (570–577) | 308 → 310 |
| Chat · phone · warm | 409 ms (400–412) | 399 ms (388–409) | 308 → 310 |
| Roundtable · phone · cold | 642 ms (625–647) | 506 ms (501–558) | 336 → 308 |
| Roundtable · phone · warm | 472 ms (460–479) | 333 ms (326–340) | 336 → 308 |
| Room · phone · cold | 680 ms (672–685) | 614 ms (607–620) | 380 → 387 |
| Room · phone · warm | 506 ms (503–514) | 438 ms (430–450) | 380 → 387 |
| Overview · phone · cold | 637 ms (593–653) | 637 ms (627–644) | 737 → 740 |
| Kept chat · phone · cold | 587 ms (569–600) | 580 ms (574–606) | 308 → 310 |

A first visit to Chat on the laptop is 28 requests and `/sw.js`, 13 of them to the API. The app's nine files come to 629 KB (197 KB as brotli), and three quarters of that is `/app.js`.

What the numbers say:

- **The pages that changed open faster on a phone, every round.** The Roundtable (what a phone opens on, `#/team`) was 656, 641 and 642 ms before and 585, 533 and 506 after, cold, and about 140 ms faster warm; a room 692, 671 and 680 before and 642, 638 and 614 after. In every round their ranges were apart. The page that listed them is now the roster, with fewer elements.
- **The pages that didn't change are where they were.** Their ranges overlapped in all three rounds but one: the Overview on the phone profile, cold, 633 ms before and 669 after in the second round (659 and 670 in the first, 637 and 637 in the third). What they carry is the new code: `/app.js` is 20.4 KB larger (6.4 KB as brotli), the page 4.2 KB (0.7 KB), about 6 ms more to fetch on the phone's line; the main thread's work on them did not grow. Chat on the phone profile was 590, 576 and 580 ms before and 609, 599 and 574 after: it now opens Galahad's most recent conversation where it opened an empty new chat, which is one more request on a device that has none remembered; the same kept chat at its own address was 572 and 587 ms before and 581 and 580 after.
- **What each part costs, in `/app.js` as brotli:** the roster as home 2.2 KB, a knight's timeline with its task cards 1.4 KB, giving a task to the Roundtable 1.2 KB, the desktop choice in the forms 0.2 KB, the desktop viewer 1.5 KB.
- **A first visit waits on round trips, not on the processor.** On the phone profile the main thread works about 103 ms of Chat's 574: layout 40, paint 17, script 17, style 14, parsing 9. The rest is four waits one after another: the page, `/app.js`, `whoami`, then the page's own data.
- **Script is the small part.** Running `/app.js` takes under 2 ms on the laptop and about 6 ms slowed 4× (Chrome's own trace). Splitting the views out (about three fifths of the file) would shorten only a first visit's download and add a round trip the first time each page is opened; on every later visit `/app.js` comes from the service worker's cache. So it stays one file.
- **A page at rest should ask nothing of the processor.** The Roundtable costs the main thread about 2.6 to 3 ms a second at rest on the laptop (2.2 to 2.3 before): the team every two seconds, and on a wide screen the sidebar's roster on every page (the team every six seconds, Galahad's work every fifteen). A chat costs about 1.8 (1.3 to 1.6 before). On a wide screen every page but Chat makes two or three more requests as it opens, for the roster beside it.

Timings move with the machine's load: measure two checkouts one after the other, and trust a difference only when their ranges don't overlap. Bytes, requests and element counts don't move.

## Code map

| Path | Owns |
|---|---|
| `index.html` | Tokens and all CSS |
| `boot.ts`, `prefs.ts` | Preferences before paint; the only localStorage access |
| `app.ts`, `shell.ts`, `live.ts`, `screens.ts` | Boot, the shell (routes, nav, palette commands, shortcuts), live polling, full-screen states |
| `pair.ts` | The pairing flow (its own bundle) |
| `ui/` | `dom` (element builder, `Scope` lifetimes), `icons`, `controls`, `dialog`, `palette`, `selector`, `toast`, `markdown`, `signal`, `avatar` |
| `lib/` | Pure, unit-tested logic: the app's places and where each is reached from (`nav`), what Galahad is doing now (`now`), the roster's rows (`roster`), a timeline (`timeline`), a task's trail and card (`trail`, `task-card`), giving a task (`give`), a knight's desktop (`desktop`), markdown parser, fuzzy search, time, text helpers |
| `views/` | One file per place (More's index is `more.ts`; the roster is `roster.ts`; a knight's or a room's timeline is `team.ts`), and the parts they share (`task-card.ts`, `team-forms.ts`, `desktop.ts`) |

Beside `src/`, and never served: `apps/web/measure/first-load.ts` (what opening the app costs, above) and `apps/web/design/` (the avatar styles side by side, and the script that draws them).

## Inspirations

- Karri Saarinen and the Linear team, on a calm interface where colour is earned: [Behind the latest design refresh](https://linear.app/blog/behind-the-latest-design-refresh), [How we redesigned the Linear UI](https://linear.app/blog/how-we-redesigned-the-linear-ui).
- Rauno Freiberg, [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design): interruptible motion, gestures that follow the finger, follow-through.
- Emil Kowalski (Sonner, Vaul): animation justified by frequency, fast ease-out, stacked toasts, draggable bottom sheets.
- Smashing Magazine, [Designing For Agentic AI: Practical UX Patterns For Control, Consent, And Accountability](https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) (Feb 2026): approvals that scale with stakes, process views, a visible Stop, visible permissions and activity, an autonomy view.
- Galahad's own [Oath](OATH.md): the autonomy classes, "creating is free; deleting asks", and how keys are handled.
