#!/bin/sh
# Put the freshly built app in /Applications, replacing any older copy.
# Run through `npm run install-app`, which builds first.
set -e

NAME="iPhone Browser"
SRC="dist/mac-universal/$NAME.app"
DEST="/Applications/$NAME.app"

if [ ! -d "$SRC" ]; then
  echo "No build at $SRC — use npm run install-app, which builds first." >&2
  exit 1
fi

# Quit a running copy first: replacing a bundle underneath a live app leaves it
# half old, half new until it's relaunched. The `is running` check matters —
# telling an app to quit that isn't open would launch it just to close it.
osascript -e "if application \"$NAME\" is running then tell application \"$NAME\" to quit" >/dev/null 2>&1 || true
for _ in $(seq 1 50); do
  pgrep -xq "$NAME" || break
  sleep 0.1
done

# Move rather than copy. A second "iPhone Browser.app" left behind in dist/ is
# one Spotlight and Launchpad happily index, so searching for the app can open
# that build instead — and it goes stale the moment anything changes. Clearing
# the old one first also keeps files dropped from a newer build from lingering.
rm -rf "$DEST"
mv "$SRC" "$DEST"
# ask Spotlight to index it now rather than whenever it gets round to it
mdimport "$DEST" >/dev/null 2>&1 || true

echo "Installed $DEST"
