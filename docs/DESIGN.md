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

A **lodestar flying at the head of swept wings**. The star is the guide (the oath he follows); the chevrons are the climb (work done, rank earned), drawn like a fighter's planform so the mark feels fast and decisive:

- **A fighter's planform.** The star is the nose. The first chevron gives its peak to the star and becomes two tapered wings; the second chevron is the tail, narrower than the wings. Wing roots, wingtips and tail tips are all cut parallel to the line of flight.
- **Planform alignment.** Every edge runs at one of two sweep angles (52° for the wings' leading edges, 40° for everything else) or along the line of flight, the way a stealth fighter aligns its edges. The harder leading-edge sweep is what tapers the wings to sharp tips.
- **One gap.** Every star tip that faces a wing or the tail stops exactly one gap short of it (the lower rays at the wing roots, the south ray at the tail's peak), and the wings fly one gap ahead of the tail. The lower rays aim at the middle of the wing roots.
- **A compass lodestar.** A long north ray, then east and west, short upper diagonals, lower rays reaching for the wings, heavy valleys. The lower rays' angle and the south ray are set by the gap.
- **Ridged facets.** Each wing and the tail is a ridge along its length: the face toward the star is lit, the face away is steel. Each ray of the star has a lit and a shaded side. The star is the brightest thing in the mark.

The proportions are named in `CREST` in `apps/web/src/brand.ts` (gap, the two sweeps, the star's centre and rays, wing and tail). Everything is generated from that one definition, tests pin the planform alignment, every gap and the symmetry, and a test fails if a committed file drifts. `assets/paragon-v1.svg` is the first drawing it grew from.

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

- Faceting is lit from the star above: on dark grounds lit faces run from white to `#d4d4d9` and shaded faces from `#d2d2d8` to steel `#a2a2ab`; on light grounds lit faces run from graphite `#4a4a4e` to black and shaded faces are near black.
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
| `--em-lit` … `--em-deep`, `--em-shade` … `--em-shade-deep`, `--em-base` | `#4a4a4e` … `#000000` | `#ffffff` … `#a2a2ab` | The emblem's lit and shaded facets, and the base under them |

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
- Headings tighten (−0.01 to −0.022em); small caps-style group labels (11 px, uppercase, +0.06em) are used only in the sidebar and palette.

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

- **Desktop (≥ 960 px):** a sidebar with the wordmark, search (⌘K / Ctrl+K), grouped navigation (Overview, Inbox, Chat · *Mind:* Memory, Activity · *Bodies:* Fleet, Sandboxes · *Keys & models:* Vault, Models), then Settings and this device. It collapses to icons (`[`); the choice is remembered. The top bar carries the fleet status pill and, while Galahad answers, an "Answering… Stop" pill.
- **Phones:** a glassy top bar with the mark, and a bottom tab bar with Home, Chat, Inbox and Fleet (or the first four destinations this device may use) plus **More**, a bottom sheet with the rest and search. Safe-area insets are honoured everywhere.
- The page title appears in the top bar only once the page's own heading has scrolled away (iOS large-title behaviour), so it is never said twice.
- **Routing** is hash-based (`#/fleet`), so links survive reloads without server routes. `#pair=…` is reserved for invites.
- **Offline:** the service worker serves the shell; a banner says "You're offline" or "Can't reach Galahad right now" and offers Retry. When a newer app has been fetched in the background, a toast offers **Reload**.

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
| SAS code | `sasCode()` | Six digits in two groups of three, large and mono, one accessible label. |
| Sheet / confirm | `ui/dialog.ts` | `<dialog>.showModal()` (focus trap, inert page, Esc). Centred on desktop, bottom sheet on phones. `confirmAction()` with optional `typeToConfirm`. |
| Command palette | `ui/palette.ts` | ARIA combobox + listbox, fuzzy ranking (`lib/fuzzy.ts`), grouped when empty, flat when searching, query-driven extras ("Search memory for …", "Ask Galahad: …"). |
| Toasts | `ui/toast.ts` | Sonner-style stack: newest in front, three visible, fan out on hover or focus, timers pause while you read, a close button, optional actions (Undo, Review, Reload). Errors stay 8 s and are announced assertively. A toast raised while a modal sheet is open waits until it closes (the page behind a modal is inert); feedback that belongs to a sheet is shown inline in it. |
| Markdown | `lib/markdown.ts` → `ui/markdown.ts` | Paragraphs, headings, lists (nested), quotes, rules, GFM tables, fenced code with language and Copy, inline code, bold, italic, strike, links. |
| Stat tile, meter, timeline | `controls.ts`, `views/activity.ts` | Figures in tabular numerals; meters turn amber past 85–90%. |

## Agentic patterns

- **Process view, not a spinner.** Each answer shows its steps as they happen: *Asked as planner* → *Thinking with anthropic/claude-opus-5-5* → (*… didn't answer: reason*, on fallback) → *Answering*. When it's done, the steps fold into one line (`planner · model · 4.2 s · 1 fallback`) that you can open again.
- **Stop is always one click away:** the send button becomes Stop while streaming, Esc stops, and from any other page the top bar shows "Answering… Stop". Enter never stops an answer: you can type your next message while this one streams. A stream keeps running while you look elsewhere.
- **The Inbox** gathers everything that needs you: devices asking to join (with their code), credentials Galahad asked for (with an inline sealed field), and a reserved slot for oath approvals ("Galahad asks to delete X"), which already explains what will appear there. New pairing requests also raise a toast with **Review**.
- **Autonomy view:** what Galahad may do alone (read; create and modify, logged), what asks (outward, delete) and what's denied (forbidden), with the last 24 hours' counts once the ledger exists. It sits on Overview and Activity.
- **Everything is visible:** the Activity timeline lists every classified action with its verdict and reason, filterable by class and verdict and grouped by day.
- **Permissions in the UI, not in settings:** Settings shows this device's scopes as granted or not; invites let you choose what a new phone may do (Everything / Chat & read / Custom); pages explain why an action is missing instead of failing.
- **Undo where possible:** clearing a conversation offers Undo. Irreversible actions confirm instead.
- **Placement playground:** "Where would this run?" ranks machines for a described piece of work, with reasons and rejections, and runs nothing.

## Safety patterns

These are enforced in code and, where possible, in tests (`packages/node/test/assets.test.ts`, `apps/web/src/lib/lib.test.ts`).

1. **No HTML from strings.** Everything is built with `createElement` / `createElementNS` / `textContent`. There is no helper that accepts HTML, and the build test fails if `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `createContextualFragment` appear in a bundle. Model output goes through a parser that emits an AST; raw HTML stays literal text.
2. **Links from models** are only ever `http(s)`, open in a new tab with `noopener noreferrer nofollow`, and carry the full URL as a tooltip. The real host is shown next to the link unless its text is itself a URL on that same host, so look-alike text can't disguise where it goes. Link text never contains another link. Images are never fetched (`img-src 'self' data:`).
3. **Keys** are typed or pasted only into `secretInput()`: `type=password`, `autocomplete=off`, `spellcheck=false`, no autocapitalise, password-manager opt-outs, and the browser's own reveal button hidden. The value is read once on submit and the field is cleared immediately, including on errors and when the sheet closes. It is never stored, logged or shown again; only the server's hint (`…3456`) is displayed.
4. **Secrets stopped at the door.** Chat and memory run `findSecrets` while you type and again at the moment of sending. A finding blocks sending and offers **Store it in the vault instead** (moves the detected key into the vault form and clears the message) or **Remove it from my message**. A chat draft is kept in memory between pages only when it has nothing secret-shaped in it. The server's 422 is shown as the same calm warning.
5. **Pairing:** the SAS is shown large; the invite proof never leaves the page; requests go to `location.origin` only; the server's SAS and the approval proof are verified before the device trusts anything. Pairing survives a reload (phones discard tabs while you walk to the laptop): on load the page asks, with its status proof, whether it already asked or was approved, and network hiccups retry. The `#pair=` hash is cleared as soon as pairing ends, whether it succeeded or not. The pairing code (with the invite schema) is its own bundle, `/pair.js`, loaded only when an invite link is opened.
6. **Typed confirmation** for the most dangerous actions: revoking a device and deleting a secret. A plain confirmation for rotating the vault, destroying a sandbox, forgetting a memory, removing a provider and forgetting this browser. Approving a *machine* asks once more, because it receives the vault.
7. **Scope-aware:** destinations and actions follow `whoami.scopes`. Missing permissions are explained, not hidden behind errors.
   - A refused request isn't taken as proof of revocation. The app asks once more, and if the node's clock disagrees with this device's by more than a minute it says so ("This device's clock is off") instead of suggesting you forget a perfectly good key. When it does leave the app, polling and shortcuts stop with it.
8. **Storage:** `localStorage` holds UI preferences only (`galahad:theme`, `galahad:motion`, `galahad:sidebar`, `galahad:last-route`, `galahad:chat-role`). The device key is a non-extractable WebCrypto key in IndexedDB. Chat lives in memory and disappears with the tab. Settings lists all of this under *Kept on this device*.
9. **CSP-clean:** no inline scripts or handlers, no external origins; inline styles only (allowed by `style-src 'unsafe-inline'`), and only with constant or numeric values.

## Accessibility

- AA contrast throughout (see Tokens); visible 2 px focus rings (`--focus`) on everything focusable.
- Full keyboard use: palette, shortcuts, arrow keys in segmented controls and the palette, Enter/Esc in dialogs, Up/Down history in the sandbox console.
- Dialogs use `showModal()`, label themselves and return focus to where you were.
- Chat has one persistent live region: it says when Galahad starts answering and reads the answer once it's complete (never token by token). Lists that refresh in the background (the ledger, fleet health) are not live regions, and background refreshes keep keyboard focus and opened sections where they were. Toasts announce through polite or assertive live regions. Counts, meters and the SAS code have text alternatives.
- Icons are decorative (`aria-hidden`) unless they carry meaning alone, in which case they get a label. Segmented controls keep an accessible name even when a phone hides their text.
- 44 px targets on touch screens; inputs at 16 px on phones.

## Keyboard

| Keys | Action |
|---|---|
| ⌘K / Ctrl+K, `/` | Search and commands |
| `G` then `O I C M A F S V L ,` | Go to Overview, Inbox, Chat, Memory, Activity, Fleet, Sandboxes, Vault, Models, Settings |
| `[` | Collapse or expand the sidebar |
| `?` | Show shortcuts |
| Enter / Shift+Enter | Send / new line (chat) |
| Esc | Stop the answer; close a dialog |

## Bundles

| File | What | Loaded |
|---|---|---|
| `/boot.js` | Theme and motion before first paint (~0.3 KB) | Always, blocking, in `<head>` |
| `/app.js` | The app (~141 KB, ~50 KB gzipped) | Always; cached by the service worker |
| `/pair.js` | The pairing flow with the invite schema (zod) | Only when a `#pair=` link is opened |
| `/sw.js` | Offline shell, stale-while-revalidate | Registered on first visit |

The PWA imports only what it needs from `@galahad/core` through subpath exports (`/bytes`, `/identity`, `/pairing`, `/request-auth`, `/secret-scan`), which keeps zod out of daily use.

## Code map

| Path | Owns |
|---|---|
| `index.html` | Tokens and all CSS |
| `boot.ts`, `prefs.ts` | Preferences before paint; the only localStorage access |
| `app.ts`, `shell.ts`, `live.ts`, `screens.ts` | Boot, the shell (routes, nav, palette commands, shortcuts), live polling, full-screen states |
| `pair.ts` | The pairing flow (its own bundle) |
| `ui/` | `dom` (element builder, `Scope` lifetimes), `icons`, `controls`, `dialog`, `palette`, `toast`, `markdown`, `signal` |
| `lib/` | Pure, unit-tested logic: markdown parser, fuzzy search, time, text helpers |
| `views/` | One file per destination |

## Inspirations

- Karri Saarinen and the Linear team, on a calm interface where colour is earned: [Behind the latest design refresh](https://linear.app/blog/behind-the-latest-design-refresh), [How we redesigned the Linear UI](https://linear.app/blog/how-we-redesigned-the-linear-ui).
- Rauno Freiberg, [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design): interruptible motion, gestures that follow the finger, follow-through.
- Emil Kowalski (Sonner, Vaul): animation justified by frequency, fast ease-out, stacked toasts, draggable bottom sheets.
- Smashing Magazine, [Designing For Agentic AI: Practical UX Patterns For Control, Consent, And Accountability](https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) (Feb 2026): approvals that scale with stakes, process views, a visible Stop, visible permissions and activity, an autonomy view.
- Galahad's own [Oath](OATH.md): the autonomy classes, "creating is free; deleting asks", and how keys are handled.
