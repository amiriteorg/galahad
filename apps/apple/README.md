# Galahad for iPhone, iPad and Mac

A SwiftUI client for a Galahad node: Apple's own components, with Galahad's accents. It pairs the way the PWA does
and signs every request the way `packages/core` verifies it. The Mac's app is the same sources built for macOS
(`GalahadMac`; [docs/MAC.md](../../docs/MAC.md)).

On an iPhone it opens on Galahad (your word, 23 November 2026: he is the one you talk to, for nearly everything): his
tab, at the bar's right end, is his home (`Galahad/UI/GalahadHome.swift`), his orb large in the colour of where he
stands, his line, what you might ask, what he asks you, your recent chats and the message box, each chat shown over it;
the Roundtable, the Inbox and More are the tabs before his. A tap anywhere but a field closes the keyboard
(`KeyboardCloser`). His orb (`Core/Orb.swift`, drawn by `UI/OrbView.swift`) is the PWA's, part for part, held to it by
the parity vectors; it is his seat at the Roundtable and in the sidebar too, and beside each answer.

On an iPhone or an iPad it keeps, besides its pairing, its key and your choices, the last Roundtable it saw, so it shows
your Roundtable at once however slow the connection (your word, 21 November 2026). It is the record Galahad for
Android keeps (`Galahad/App/KeptTable.swift`): the team in the fields its roster reads (no knight's instructions or
notes, no task's brief), the chats' titles, which approvals wait (who asks and for which tool, never what a request
holds) and how many things wait for you. It is in the app's caches (never backed up; the system may clear them),
readable only while the device is unlocked, drawn only for the node and key it came from, and only looked at: giving,
adding, arranging and editing wait for the node's first answer, which replaces it. If that answer is slow, a still line
says what you're looking at. Forgetting the node deletes it. The Mac keeps none of it.

Needs Xcode 27 (Swift 6, the iOS 27 and macOS 27 SDKs) and [XcodeGen](https://github.com/yonaskolb/XcodeGen). It runs on
iOS 26 and later, and on macOS 27.

```sh
cd apps/apple
xcodegen generate                      # writes Galahad.xcodeproj and each app's Info.plist from project.yml (none is committed)
xcodebuild -project Galahad.xcodeproj -scheme Galahad \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build test
xcodebuild -project Galahad.xcodeproj -scheme GalahadMac -destination 'platform=macOS' -derivedDataPath build test
```

The Mac's build is signed to run on this Mac only: no team, no account, and no node inside (below: *Its node*).

## Running it against a throwaway node

`scripts/dev-node.ts` starts a node the way `apps/web/measure/first-load.ts` does: a temp home, the file keystore, a
stand-in Docker and stand-in models, on loopback only (never `~/.galahad`). It seats a few knights in every state the
Roundtable shows (at work, waiting for your approval, failed, paused, at rest), has an agent ask your leave, Galahad
ask for a key and a rule of yours tell you of a command he ran (a notice in the Inbox), and prints a client invite. The simulator reaches it on 127.0.0.1.

```sh
bun apps/apple/scripts/dev-node.ts --dir /tmp/galahad-dev    # from the repository's root; prints the invite link
```

Paste the link into the app and press Ask to join (on a Mac, opening a `galahad:` link that carries it fills it in too:
`galahad:` and the link, or `galahad://pair#pair=` and the invite). The node prints the code the request shows; compare it with the
app's, then approve as the node's owner would: `echo 482913 > /tmp/galahad-dev/approve` (the code, its digits only).

Ask Galahad anything with "show" in it, and the stand-in answers with everything an answer can hold: headings, a
list, a quote, a table, code, a chart, figures, a plan's steps, a page and choices to tap. A message with "Take your
time" is never answered, so a turn stays running to leave and come back to.

It also seats a room of two (Kay and Gareth), who answer you there, and gives Gawain a VM with a desktop: his screen
(Gawain → the display button) shows a browser's blank tab until you open an address, then a page; taps and keys go
to the node as they would to a real VM's (the pictures are `scripts/fixtures/screen-*.jpg`). His terminal (Gawain → Its
VM → Its terminal) is a stand-in shell in the node, never one on this machine: it echoes what you type and answers
`claude auth login` as Claude Code does (an address to open, then a code to paste), which "Sign a tool in" types. Ask a knight to "propose" something and its
stand-in proposes a task with its tool, so its card comes up to approve. Keys (More → Keys) recognise a pasted key's
provider or coding plan the PWA's way, refuse a subscription's sign-in, and keep a copy on the iPhone only when asked.

The node lets one app in: give each app, and each run of `MacShots` below, a node of its own.

## The iPad

The Mac's window (`Galahad/UI/Places.swift`, shared by both): the places in a sidebar, the Roundtable as the PWA's wide
screen has it (its mark, which opens its board of cards; the one who leads and the knights in your order, each face in
its still ring; the rooms; the Inbox and More), and the place chosen beside it. Each window keeps its own place across
launches; a knight, a room or one of Galahad's chats opens in a window of its own (its row's menu); the menus (iPadOS's
menu bar) have ⌘N a new chat, ⌥⌘N a new window, ⌘K a task for the Roundtable and ⌘1 to ⌘4 the places, acting in the window
in front. A narrow window (Slide Over, a thin split) is the iPhone's four tabs. One `AppModel` serves every window, and
one loop asks the node again while any of them is in front.

## The Mac

The iPad's sidebar and detail, with the Roundtable as the sidebar; a knight, a room or one of Galahad's chats in a window
of its own; ⌘N a new chat, ⌘K a task for the Roundtable, ⌘1 to ⌘4 the places, ⌘, Settings; and the Roundtable in the
menu bar. What only one platform has is marked `#if os(iOS)` or `#if os(macOS)` in the shared sources, and what differs in
small ways goes through `Galahad/UI/Platform.swift`, whose helpers are exactly the old iOS modifier on iOS. The Mac's own
views are in `Galahad/Mac` (left out of the iOS target).

Its key is made in the Secure Enclave and kept, wrapped by it, in the login keychain (`Core/DeviceKey.swift` says why).
It keeps no copies of keys and takes no notifications yet: both need a provisioning profile with its Developer ID.

### Its node

The app is also the node (docs/MAC.md, M2): its first run makes a Mac with no `~/.galahad` a node (start a fleet, join
yours, or just the app), This Mac shows it (Settings, and the sidebar's foot), and its binary is the node's launcher. An
everyday build carries no node, and says so. `scripts/mac-node-bundle.sh` puts it into a built app (the pinned Bun, the
repository at HEAD with its dependencies, the agent's plist) and signs it; then the app must be in an Applications folder
before it registers anything.

```sh
cd apps/apple && xcodegen generate
xcodebuild -scheme GalahadMac -configuration Release -destination 'platform=macOS' -derivedDataPath build build
scripts/mac-node-bundle.sh build/Build/Products/Release/Galahad.app                                   # ad hoc: this Mac
GALAHAD_MAC_SIGN=developer-id scripts/mac-node-bundle.sh build/Build/Products/Release/Galahad.app     # a release
ditto -c -k --keepParent build/Build/Products/Release/Galahad.app /tmp/Galahad.zip
xcrun notarytool submit /tmp/Galahad.zip --keychain-profile galahad-notary --wait && xcrun stapler staple build/Build/Products/Release/Galahad.app
```

A release that the installed apps update to is one command, then two steps to publish: `scripts/mac-release.sh`
builds it (numbered by the time, UTC, so each is newer than the last), bundles and signs its node, notarizes and
staples it, signs the zip with the owner's Sparkle key (the login keychain's account `galahad`; never printed, never
in here), and writes `apps/site/public/mac/appcast.xml` for that release. The zip is too big for the site, so it goes
up as the GitHub release `mac-<build>` (`gh release create`, as the script prints), and the feed goes out with the
site when it is committed and pushed. Each app checks the feed once a day, and from **Check for Updates…**.

The same binary, from a terminal (what a Mac with no screen to click is tried with):

```sh
Galahad.app/Contents/MacOS/Galahad --serve-node                     # the node, as launchd runs it
Galahad.app/Contents/MacOS/Galahad --cli doctor                     # the bundled CLI
Galahad.app/Contents/MacOS/Galahad --agent status                   # register | unregister | restart
open --stdout /tmp/out.txt /Applications/Galahad.app --args --first-run start --name mini --fleet camelot
Galahad.app/Contents/MacOS/Galahad --this-mac                       # what This Mac shows
```

`--first-run` makes the Mac a node, so run it in a VM or on the Mac that will serve, never on a laptop by mistake; through
`open`, it runs in your session, where the keys go to the Keychain. Updates come through Sparkle (2.10.1), from
`https://galahad.sh/mac/appcast.xml`; they stay off until `GALAHAD_SPARKLE_PUBLIC_KEY` holds the owner's public key (Sparkle's
`generate_keys`, the private half kept in their keychain, never here).

`MacShots` pictures the Mac app as it looks, light and dark, against a dev node: the first run's three steps, joining,
the main window (This Mac among its places, and the Inbox down to what was noticed), Settings, the app menu with Check
for Updates, and the menu bar. It pairs as
you would, the codes compared before it approves, and pictures the app's own windows (an app may picture its own windows
without being let record the screen). This Mac's node is shown as given (`ThisMac.show`), since a build here carries none
and this Mac is never made one; the first run is pictured in a window of the test's, as if the build carried the node.
The menu bar's panel is pictured in a panel of the test's, on the menu's material: SwiftUI fills its own only for a click
on the mark. While you use the Mac, macOS keeps the test's app from coming in front, and its windows are pictured as a
window behind another is drawn.

```sh
bun apps/apple/scripts/dev-node.ts --dir /tmp/galahad-mac-shots &
cd apps/apple && TEST_RUNNER_GALAHAD_DEV_NODE=/tmp/galahad-mac-shots TEST_RUNNER_GALAHAD_SHOTS=/tmp/galahad-mac-pictures \
  xcodebuild -scheme GalahadMac -destination 'platform=macOS' -derivedDataPath build test -only-testing:GalahadMacTests/MacShots
```

## TestFlight

`scripts/testflight.sh` archives the app for devices, signs it for your team (Xcode's automatic signing makes the
distribution certificate and profile with the key, the first time) and uploads it to App Store Connect, where
TestFlight offers it to your testers once Apple has processed it. It needs:

- an App Store Connect API team key with the Admin role (Users and Access → Integrations → App Store Connect API):
  its `.p8` file, its key ID and its issuer ID. The script keeps nothing of it: give it the path of a file you delete
  afterwards;
- your team id, given when you run it and never committed;
- the app in App Store Connect (Apps → New App, bundle ID `org.amirite.galahad`): Apple's API can't make one.

```sh
TEAM_ID=… ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=/path/to/AuthKey.p8 apps/apple/scripts/testflight.sh
```

Each upload is a new build, numbered by the time (UTC, `yyyymmddHHMM`). `Galahad/PrivacyInfo.xcprivacy` says what the
App Store asks: the app tracks no one and collects nothing, and the one "required reason" API it uses is UserDefaults,
for the node it paired with and whether an iPad shows the Roundtable's knights as cards.

## What the tests are held to

The Swift tests (on iOS and, the same ones, on macOS) read `GalahadTests/Fixtures/core-vectors.json`: test vectors made by `packages/core` itself (and the
PWA's roster), each one checked against core before it is written. After a change to core, write them again, and
check them in CI or before a commit:

```sh
bun apps/apple/scripts/vectors.ts           # from the repository's root
bun apps/apple/scripts/vectors.ts --check   # exits 1 if the file isn't what core makes now
```

## Galahad's accents

The app is Apple's own components; what is Galahad's comes from the PWA, never copied by hand:

- **The knights** are the owner's drawings, `apps/web/src/knights/*.webp`, bundled as they are (`project.yml`): never
  redrawn, recoloured, outlined or moved.
- **The icon, the Roundtable's mark and the colours** (Galahad's red for what needs you and his seat, the cream ink,
  the black tile) are written from `apps/web/src/brand.ts` by `bun apps/apple/scripts/brand.ts`, which renders
  `appIcon()` with headless Chrome and ImageMagick. iOS rounds an icon's corners itself, so the icon is the tile edge
  to edge, with the Roundtable seated as `appIcon()` seats it. The Mac's (`Galahad/Mac/MacAssets.xcassets`) is the same
  icon at a Mac icon's sizes: macOS 27 clips it to its own shape and inset.
