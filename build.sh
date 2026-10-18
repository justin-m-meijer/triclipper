#!/bin/bash
# Builds Tri Clipper.app with its Safari web extension inside.
# Command Line Tools only — there is no Xcode.app on this machine.
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="Tri Clipper"
APP="build/$APP_NAME.app"
APPEX="$APP/Contents/PlugIns/$APP_NAME Extension.appex"
SDK="$(xcrun --show-sdk-path)"

rm -rf "$APP"
mkdir -p "$APP/Contents/"{MacOS,Resources} "$APPEX/Contents/"{MacOS,Resources}

echo "→ containing app"
swiftc -O -sdk "$SDK" -target arm64-apple-macos13.0 \
  -module-name TriClipper \
  -framework AppKit -framework SafariServices \
  -o "$APP/Contents/MacOS/TriClipper" \
  Sources/App/main.swift

echo "→ extension handler"
# App extensions are entered through NSExtensionMain, not main(); Xcode passes
# the same -e flag. Without it the binary launches and immediately exits.
swiftc -O -sdk "$SDK" -target arm64-apple-macos13.0 \
  -module-name TriClipperExtension \
  -parse-as-library \
  -framework Foundation -framework SafariServices \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -o "$APPEX/Contents/MacOS/TriClipperExtension" \
  Sources/Handler/SafariWebExtensionHandler.swift

echo "→ resources"
cp Support/App-Info.plist "$APP/Contents/Info.plist"
cp Support/Extension-Info.plist "$APPEX/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"
printf 'XPC!????' > "$APPEX/Contents/PkgInfo"
[ -f Resources/AppIcon.icns ] && cp Resources/AppIcon.icns "$APP/Contents/Resources/"
# The App Store rejects a submission without a privacy manifest in every bundle.
cp Support/PrivacyInfo.xcprivacy "$APP/Contents/Resources/"
cp Support/PrivacyInfo.xcprivacy "$APPEX/Contents/Resources/"
cp -R Extension/. "$APPEX/Contents/Resources/"
find "$APPEX/Contents/Resources" -name '.DS_Store' -delete

echo "→ signing (ad-hoc)"
# Inner bundle first: signing the app seals whatever is inside it at that moment.
codesign --force --sign - --timestamp=none \
  --entitlements Support/Extension.entitlements "$APPEX"
codesign --force --sign - --timestamp=none \
  --entitlements Support/App.entitlements "$APP"
codesign --verify --deep --strict "$APP"

echo "✓ $APP"
