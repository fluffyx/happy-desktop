#!/bin/sh
#
# build-fluffy.sh — build Fluffy.app locally: Developer ID-signed from the
# Keychain, notarized through a notarytool keychain profile, stapled, and
# checked with codesign and Gatekeeper.
#
# Usage: scripts/build-fluffy.sh [--unsigned] [--arch arm64|x64|all]
#                                [--team-id ID] [--notary-profile NAME]
#
#   --team-id         Developer ID team whose certificate signs the app.
#                     Default: $FLUFFY_TEAM_ID or T6WFD82P2T.
#   --notary-profile  Keychain profile created once with
#                     `xcrun notarytool store-credentials`.
#                     Default: $FLUFFY_NOTARY_PROFILE or fastpass-notary.
#   --arch            Default: arm64.
#   --unsigned        Ad-hoc sign and skip notarization, to check the
#                     packaging path without release credentials.
#
# The app lands in packages/happy-desktop-electron/release/standard/mac-arm64
# (or mac/ for x64), next to its DMG and zip.

set -eu

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

TEAM_ID="${FLUFFY_TEAM_ID:-T6WFD82P2T}"
NOTARY_PROFILE="${FLUFFY_NOTARY_PROFILE:-fastpass-notary}"
ARCH="arm64"
UNSIGNED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --unsigned) UNSIGNED=1 ;;
    --arch) ARCH="$2"; shift ;;
    --team-id) TEAM_ID="$2"; shift ;;
    --notary-profile) NOTARY_PROFILE="$2"; shift ;;
    *) echo "error: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

# Fluffy is a personal build: it never ships an analytics key, and notarizes only
# through the keychain profile, so no other Apple credential can take precedence.
unset HAPPY_POSTHOG_API_KEY APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID \
  APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER CSC_LINK CSC_KEY_PASSWORD

if [ "$UNSIGNED" -eq 1 ]; then
  echo "==> Building ad-hoc signed Fluffy ($ARCH), not notarized…"
  node scripts/build-mac-apps.mjs --flavor standard --arch "$ARCH" --unsigned
else
  echo "==> Checking the Developer ID identity for team $TEAM_ID…"
  if ! security find-identity -v -p codesigning | grep "Developer ID Application:" | grep -q "($TEAM_ID)"; then
    echo "error: no Developer ID Application identity for team $TEAM_ID in Keychain." >&2
    exit 1
  fi
  echo "==> Checking notary keychain profile $NOTARY_PROFILE…"
  if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null; then
    echo "error: notary keychain profile $NOTARY_PROFILE is missing or rejected." >&2
    echo "       Create it once with: xcrun notarytool store-credentials $NOTARY_PROFILE --help" >&2
    exit 1
  fi
  echo "==> Building, signing, notarizing, and stapling Fluffy ($ARCH)…"
  CSC_NAME="$TEAM_ID" APPLE_KEYCHAIN_PROFILE="$NOTARY_PROFILE" \
    node scripts/build-mac-apps.mjs --flavor standard --arch "$ARCH"
fi

RELEASE_DIR="$REPO_ROOT/packages/happy-desktop-electron/release/standard"
case "$ARCH" in
  arm64) APPS="$RELEASE_DIR/mac-arm64/Fluffy.app" ;;
  x64) APPS="$RELEASE_DIR/mac/Fluffy.app" ;;
  all) APPS="$RELEASE_DIR/mac-arm64/Fluffy.app $RELEASE_DIR/mac/Fluffy.app" ;;
  *) echo "error: --arch must be arm64, x64, or all" >&2; exit 2 ;;
esac

for APP in $APPS; do
  echo "==> Done: $APP"
  codesign -dvv "$APP" 2>&1 | grep -E "Identifier|Authority|TeamIdentifier|Signature"
  if [ "$UNSIGNED" -eq 0 ]; then
    if ! codesign -dvv "$APP" 2>&1 | grep -q "^TeamIdentifier=$TEAM_ID\$"; then
      echo "error: $APP is not signed by team $TEAM_ID." >&2
      exit 1
    fi
    xcrun stapler validate "$APP"
    spctl -a -vv "$APP"
  fi
done
