#!/bin/bash
# Builds Tri Clipper for iOS and iPadOS, the same way build.sh does for macOS:
# bundles assembled by hand, no Xcode project to keep in sync.
#
#   ./build-ios.sh              simulator build, for testing
#   ./build-ios.sh device       device build, for signing and the App Store
#
# An iOS bundle is flat — no Contents/ — and needs a compiled asset catalogue
# for its icon, which is the one thing here that the macOS build does not.
set -euo pipefail
cd "$(dirname "$0")"

TARGET_OS="${1:-simulator}"
APP_NAME="Tri Clipper"
DEPLOY=16.0

if [ "$TARGET_OS" = "device" ]; then
  SDK_NAME=iphoneos
  TRIPLE="arm64-apple-ios$DEPLOY"
  OUT="build/ios-device"
else
  SDK_NAME=iphonesimulator
  TRIPLE="arm64-apple-ios$DEPLOY-simulator"
  OUT="build/ios-simulator"
fi

SDK="$(xcrun --sdk $SDK_NAME --show-sdk-path)"
SWIFTC=(xcrun --sdk "$SDK_NAME" swiftc)
APP="$OUT/$APP_NAME.app"
APPEX="$APP/PlugIns/$APP_NAME Extension.appex"

rm -rf "$APP"
mkdir -p "$APP" "$APPEX"

echo "→ app ($TARGET_OS)"
"${SWIFTC[@]}" -O -target "$TRIPLE" \
  -module-name TriClipper -parse-as-library \
  -framework SwiftUI -framework UIKit \
  -o "$APP/TriClipper" \
  Sources/App-iOS/main.swift

echo "→ extension handler"
# Same entry point trick as on macOS: app extensions start at NSExtensionMain,
# not at main().
"${SWIFTC[@]}" -O -target "$TRIPLE" \
  -module-name TriClipperExtension -parse-as-library \
  -framework Foundation -framework SafariServices \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -o "$APPEX/TriClipperExtension" \
  Sources/Handler/SafariWebExtensionHandler.swift

echo "→ icon"
PARTIAL=$(mktemp)
actool Resources/Assets.xcassets \
  --compile "$APP" \
  --platform "$SDK_NAME" \
  --minimum-deployment-target "$DEPLOY" \
  --app-icon AppIcon \
  --output-partial-info-plist "$PARTIAL" \
  --output-format human-readable-text >/dev/null

echo "→ resources"
# actool reports the icon names it produced; merging its output is what puts
# CFBundleIcons into the Info.plist instead of guessing at the keys.
python3 - "$PARTIAL" Support/iOS-App-Info.plist "$APP/Info.plist" <<'PY'
import plistlib, sys
partial, source, target = sys.argv[1:4]
with open(source, "rb") as handle:
    info = plistlib.load(handle)
with open(partial, "rb") as handle:
    info.update(plistlib.load(handle))
with open(target, "wb") as handle:
    plistlib.dump(info, handle, sort_keys=True)
PY
rm -f "$PARTIAL"
cp Support/iOS-Extension-Info.plist "$APPEX/Info.plist"
cp Support/PrivacyInfo.xcprivacy "$APP/"
cp Support/PrivacyInfo.xcprivacy "$APPEX/"
cp -R Extension/. "$APPEX/"
find "$APPEX" -name '.DS_Store' -delete

if [ "$TARGET_OS" = "device" ]; then
  echo "→ signing (ad-hoc)"
  codesign --force --sign - --entitlements Support/Extension.entitlements "$APPEX"
  codesign --force --sign - --entitlements Support/App.entitlements "$APP"
else
  # The simulator runs unsigned code, and signing for it needs no identity.
  codesign --force --sign - "$APPEX" 2>/dev/null || true
  codesign --force --sign - "$APP" 2>/dev/null || true
fi

echo "✓ $APP"
