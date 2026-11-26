# Galahad for Android

A native client for a Galahad node: Kotlin and Jetpack Compose, Android's own components with Galahad's accents, as
the Apple app is Apple's. It pairs the way the PWA and the Apple app do and signs every request the way
`packages/core` verifies it, with a device key made in the phone's secure hardware (the Keystore: StrongBox where the
phone has one) that never leaves it.

It's small on purpose: a signed release is about 3 MB, nearly all of it the code; it carries no pictures of the
knights, which it draws itself. It needs no Google services: HTTP, JSON and the cryptography are what Android ships, and
the only libraries are AndroidX's Compose, activity-compose and profile installer, and Kotlin's coroutines. Every orb
is Galahad's field (your words, 26 November 2026: the glyph spheres looked "almost like nipples", and "i dont want them
to be too visually distractin"): lines of force round a dark core (`core/Field.kt`, `core/FieldOrb.kt`, drawn by
`ui/Field.kt`), the PWA's lib/field.ts and lib/field-orb.ts, held to them by the parity vectors' `field` section. His is
in gold with his lance of light through it along his axis (his heads-up ring went the same day: "remove the old mark
around galahad. make the primary agent distinct in some other cool way"); each knight's is in the colour you chose for
it on its page or the one of 24 its handle picks (`core/Avatar.kt`, core's avatar.ts), with its handle's lean and lines.
Where orbs are many they are still, drawn once; the one in focus moves slowly in its mood (his on Home, a knight's in
its own thread while it works), only as often as the mood needs (his turns once a minute at rest; a knight's settles to
no frames at all), and never while the phone's animations are off. In the light theme a field is ink on paper. The app's own mark (the sidebar's head, Settings' About) is his
field alone, on nothing (`AppMark`).

It opens on Galahad (your word, 23 November 2026: he is the one you talk to, for nearly everything), with no tab bar:
Home (`ui/Home.kt`) is his orb, his name, the line at a glance, the machine chip and "…" for everything else (the
Roundtable, the Inbox, his chats, keys, connectors, settings, a task to give), then what needs you with each answer in
place, the work by attention, and his message box docked. A task opens as a thread of its own (`ui/TaskScreen.kt`). A
tablet (720 dp and wider) has T3's panes: the sidebar (`ui/Sidebar.kt`) beside the page.

What it does (21 November 2026): join your node with an invite and the six-digit code; the Roundtable, Galahad first,
each knight in its state's ring with one line of what it's doing (the same line the PWA and the iPhone show: the roster
is ported and held to the same parity vectors), and your rooms; Galahad's chat, his answer streamed as he writes it, with
his answer blocks drawn (charts, figures, steps, choices to tap, pages in a sandboxed viewer), photos and text files sent
with a message, and anything shared to the app from another; a knight's page: its timeline, a box to write to it or
give it a task, Stop, Resume and Ship, pausing it, its terminal and its desktop; the Inbox, as the iPhone's has it
(devices asking to join, services' questions, his use of a Mac itself, approvals, keys asked for, facts he noticed about
you, and what your node noticed); while you were away; and More: notifications (instant through a UnifiedPush
distributor such as Sunup or ntfy, encrypted to the phone, or collected from the node every fifteen minutes or so),
your keys, your connectors and the library of services' own MCP servers. More also says when a newer build is out (it
asks galahad.sh's `android/latest.json` at most once a day, sending nothing of yours) and downloads it from GitHub's
releases; it installs over the last because every build is signed with the same key. Not yet: Google Play.

What it keeps on the phone: its pairing, its device key (in the Keystore, never readable), your notification choices,
and, so it shows your Roundtable at once however slow the connection (your word, 21 November 2026), the last
Roundtable it saw: the team in the fields its roster reads (no knight's instructions or notes, no task's brief), the
chats' titles, which approvals wait (who asks and for which tool, never what a request holds) and how many things wait
for you (`app/KeptTable.kt`). It is in the app's own storage, never backed up, drawn only for the node and key it came
from, and replaced by the node's first answer; if that answer is slow, a still line says what you're looking at.
Forgetting the node deletes it. The iPhone and iPad app keeps the same.

Needs JDK 17 and the Android SDK (platform 37, build tools); Gradle comes with the wrapper (its checksum pinned).

```sh
cd apps/android
./gradlew testDebugUnitTest        # the protocol, the roster and the answer blocks, against apps/apple's parity vectors
./gradlew assembleDebug            # app/build/outputs/apk/debug/app-debug.apk (org.amirite.galahad.debug)
scripts/make-key.sh                # once: the release key, outside the repository, its password in this Mac's keychain
scripts/release.sh                 # build/release/Galahad-<build>.apk: tested, shrunk by R8, signed, verified
```

The JVM tests read `apps/apple/GalahadTests/Fixtures/core-vectors.json` where it is (`bun apps/apple/scripts/vectors.ts`
writes it from core and the push gate checks it), so this app is held to the same bytes as the Apple app: request
signing, the device id, canonical JSON, invites, the pairing proofs and codes, the Roundtable's rows, the orbs (a
knight's colours, every sphere's glyphs at a moment, a knight's arcs, Galahad's parts and data ring, and how each mood
moves), and every answer block.

## Running it against a throwaway node

The Apple app's dev node serves this app too (a temp home, stand-in models, loopback only). An emulator reaches its
host's loopback through `adb reverse`:

```sh
bun apps/apple/scripts/dev-node.ts --dir /tmp/galahad-dev      # from the repository's root; prints the invite link
adb reverse tcp:<port> tcp:<port>                               # the port in the link, and the one before it
```

Paste the link into the app, press Ask to join, compare the codes, then approve: `echo <code> > /tmp/galahad-dev/approve`.
Plain HTTP is allowed only to this phone itself or an emulator's host (`network_security.xml`); a real node is reached
over HTTPS, its `tailscale serve` address.
