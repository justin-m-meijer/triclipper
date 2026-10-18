#!/bin/bash
# Builds, then puts the app where Safari will find it.
set -euo pipefail
cd "$(dirname "$0")"

./build.sh

APP="/Applications/Tri Clipper.app"
osascript -e 'quit app "Tri Clipper"' 2>/dev/null || true
rm -rf "$APP"

# The copy in build/ gets registered too if it is ever opened, and then Safari
# lists the extension twice and may load the stale one. Drop it first.
pluginkit -r "build/Tri Clipper.app/Contents/PlugIns/Tri Clipper Extension.appex" 2>/dev/null || true
cp -R "build/Tri Clipper.app" /Applications/

# Safari discovers the extension through LaunchServices, and only after the
# containing app has been registered and run once.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
open -g "$APP"
sleep 3

if pluginkit -m -p com.apple.Safari.web-extension 2>/dev/null | grep -q nl.justinmeijer.triclipper; then
  echo
  echo "✓ macOS has registered the extension."
else
  echo
  echo "✗ macOS did not register the extension. Try opening $APP by hand."
  exit 1
fi

cat <<'NEXT'

Next, in Safari:
  1. Safari → Settings → Advanced → tick "Show features for web developers".
  2. Develop → Developer Settings… → tick "Allow unsigned extensions".
     (This one resets every time Safari quits — see README.)
  3. Safari → Settings → Extensions → switch on "Tri Clipper",
     and set its site access to "Allow on Every Website".
  4. Click the toolbar button → the gear → fill in your server and ETAPI token.
NEXT
