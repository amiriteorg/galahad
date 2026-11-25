# Galahad for Android

A native client for a Galahad node: Kotlin and Jetpack Compose, Android's own components with Galahad's accents, as
the Apple app is Apple's. It pairs the way the PWA and the Apple app do and signs every request the way
`packages/core` verifies it, with a device key made in the phone's secure hardware (the Keystore: StrongBox where the
phone has one) that never leaves it.

It's small on purpose: a signed release is about 3 MB, nearly all of it the code; it carries no pictures of the
knights, which it draws itself. It needs no Google services: HTTP, JSON and the cryptography are what Android ships, and
the only libraries are AndroidX's Compose, activity-compose and profile installer, and Kotlin's coroutines. Every knight
is an orb (your words, 25 November 2026: "drop the knight avatars, and just use custom/procedurally generated colored
particle orbs", "use glyph and randomness on the orbs, like Jarvis/Ultron in the movies, and my other project Phren"):
a sphere of monospace glyphs round a bright nucleus, in the colour you chose for it on its page or the one of 24 its
handle picks (`core/Avatar.kt`, core's avatar.ts), its sphere, glyphs and arcs its handle's (`core/OrbSphere.kt`, the
PWA's lib/orb-sphere.ts), ink on paper in the light theme. A state moves as long as it lasts (your word, 24 November
2026), slowly and calmly (25 November 2026: "slow and calming movement"): Galahad's orb and every knight's orb in its
seat in their state's mood (`core/OrbMotion.kt`, the PWA's lib/orb-motion.ts held to it by the vectors), only as often
as the mood needs, and one still frame while the phone's animations are off; a knight's state is still its ring's
colour and a word.

It opens on Galahad (your word, 23 November 2026: he is the one you talk to, for nearly everything): his place, at the
bar's right end, is his home (`ui/GalahadHome.kt`), his orb large in the colour of where he stands, his line, what you
might ask, what he asks you (the Inbox's own cards), your recent chats and the message box, each chat shown over it. His
orb (`core/Orb.kt`, drawn by `ui/Orb.kt`: his heads-up rings, a ring of data turning in them, and his own sphere of
glyphs) is the PWA's and the iPhone's, part for part, held to them by the parity vectors, and moves as theirs do; it is
his seat at the Roundtable and the place's icon too (still, in the bar).

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
