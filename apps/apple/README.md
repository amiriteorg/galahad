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
