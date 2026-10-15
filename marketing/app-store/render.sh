#!/bin/sh
# Renders slides.html into the App Store screenshots: 2880 x 1800, opaque PNG
# (App Store Connect refuses images with an alpha channel). Run capture.mjs
# first; this only reads its output.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/out}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$OUT"

# the readout on slide 6, from what the page reported (file:// can't fetch JSON)
printf 'window.NUMBERS = %s;\n' "$(cat "$HERE/captures/numbers.json")" > "$HERE/captures/numbers.js"

PROFILE="$(mktemp -d)"
for n in 1 2 3 4 5 6 7; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$PROFILE" \
    --force-device-scale-factor=2 --window-size=1440,900 --virtual-time-budget=5000 \
    --screenshot="$OUT/0$n.png" "file://$HERE/slides.html#$n" >/dev/null 2>&1
done
rm -rf "$PROFILE"

python3 - "$OUT" <<'PY'
import sys, pathlib
from PIL import Image
for f in sorted(pathlib.Path(sys.argv[1]).glob('0*.png')):
    im = Image.open(f).convert('RGB')
    assert im.size == (2880, 1800), f'{f.name} is {im.size}'
    im.save(f, optimize=True)
    print(f.name, im.size, im.mode)
PY
