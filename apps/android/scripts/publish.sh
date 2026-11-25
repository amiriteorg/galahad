#!/usr/bin/env bash
# Publishes a release build (scripts/release.sh's) as a GitHub release, android-<build>, and writes what galahad.sh's
# download says of it (apps/site/public/android/latest.json, read by apps/site/src/lib/facts.ts as the Mac's feed is):
# the newest signed APK, where it is, its size, its SHA-256 and the certificate it is signed with. Its tag goes on
# sovware.io first (scripts/release-tag.sh), on the commit the build is of, and reaches GitHub through the mirror.
#
#   apps/android/scripts/publish.sh build/release/Galahad-<build>.apk [commit]     (commit: HEAD)
set -euo pipefail
cd "$(dirname "$0")/.."
APK=${1:?the APK scripts/release.sh built}
COMMIT=${2:-HEAD}
[[ $APK =~ Galahad-(20[0-9]{10})\.apk$ ]] || { echo "an APK scripts/release.sh built: Galahad-<build>.apk" >&2; exit 1; }
BUILD=${BASH_REMATCH[1]}
TOOLS=$(ls -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/* | sort -V | tail -1)
"$TOOLS/apksigner" verify --min-sdk-version 29 "$APK"
CERT=$("$TOOLS/apksigner" verify --print-certs "$APK" | sed -n 's/.*certificate SHA-256 digest: //p' | head -1)
VERSION=$("$TOOLS/aapt2" dump badging "$APK" | sed -n "s/.*versionName='\([^ ']*\).*/\1/p" | head -1)
SHA=$(shasum -a 256 "$APK" | cut -d' ' -f1)
SIZE=$(stat -f %z "$APK")
TAG=android-$BUILD
NAME=Galahad-$BUILD.apk
NOTES="Galahad for Android, build $BUILD (version $VERSION), for Android 10 and later.

Open the APK on your phone to install it (Android asks once to allow installs from your browser), then join your node
with an invite: on the node, \`galahad invite --client\`, and compare the six-digit code on both screens.

Signed with Galahad's release key: certificate SHA-256 $CERT. Every build is signed with the same key, so each installs
over the last. The APK's SHA-256: $SHA."
../../scripts/release-tag.sh "$TAG" "$COMMIT"
gh release create "$TAG" "$APK#$NAME" --repo amiriteorg/galahad --verify-tag --title "Galahad for Android $BUILD" --notes "$NOTES"
cat > ../site/public/android/latest.json <<JSON
{
  "version": "$VERSION",
  "build": "$BUILD",
  "url": "https://github.com/amiriteorg/galahad/releases/download/$TAG/$NAME",
  "size": $SIZE,
  "sha256": "$SHA",
  "certificate": "$CERT",
  "minSdk": 29,
  "date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "published $TAG; galahad.sh's download is in apps/site/public/android/latest.json (commit it)"
