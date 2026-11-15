# Galahad for iPhone and iPad

A SwiftUI client for a Galahad node: Apple's own components, with Galahad's accents. It pairs the way the PWA does
and signs every request the way `packages/core` verifies it.

Needs Xcode 27 (Swift 6, the iOS 27 SDK) and [XcodeGen](https://github.com/yonaskolb/XcodeGen). It runs on iOS 26 and
later.

```sh
cd apps/apple
xcodegen generate                      # writes Galahad.xcodeproj and Galahad/Info.plist from project.yml (neither is committed)
xcodebuild -project Galahad.xcodeproj -scheme Galahad \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build test
```

## Running it against a throwaway node

`scripts/dev-node.ts` starts a node the way `apps/web/measure/first-load.ts` does: a temp home, the file keystore, a
stand-in Docker and stand-in models, on loopback only (never `~/.galahad`). It seats a few knights at work, has an
agent ask your leave and Galahad ask for a key, and prints a client invite. The simulator reaches it on 127.0.0.1.

```sh
bun apps/apple/scripts/dev-node.ts --dir /tmp/galahad-dev    # from the repository's root; prints the invite link
```

Paste the link into the app and press Ask to join. The node prints the code the request shows; compare it with the
app's, then approve as the node's owner would: `echo 482913 > /tmp/galahad-dev/approve` (the code, its digits only).

## What the tests are held to

The Swift tests read `GalahadTests/Fixtures/core-vectors.json`: test vectors made by `packages/core` itself (and the
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
  to edge, with the Roundtable seated as `appIcon()` seats it.
