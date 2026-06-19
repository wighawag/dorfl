#!/usr/bin/env bash
#
# Render every Dorfl branding SVG in this folder to PNG under ./out/.
#
# SVGs are the source of truth (tracked in git). The PNGs in ./out/ are
# generated artifacts (gitignored) — regenerate them anytime with:
#
#   ./build.sh
#
# Requires ImageMagick v7 (`magick`). Falls back to v6 (`convert`) if needed.
#
# For each <name>.svg this writes:
#   out/<name>.png          full-size render (intrinsic SVG width)
#   out/<name>@512.png      512x512 square (icons/hero)
#   out/<name>-favicon.png  32x32 (favicon; best results from the mono glyph)
#
set -euo pipefail

cd "$(dirname "$0")"
OUT="out"
mkdir -p "$OUT"

# pick an ImageMagick CLI
if command -v magick >/dev/null 2>&1; then
  IM="magick"
elif command -v convert >/dev/null 2>&1; then
  IM="convert"
else
  echo "error: ImageMagick not found (need 'magick' or 'convert')." >&2
  echo "       install it, e.g.  brew install imagemagick  /  apt install imagemagick" >&2
  exit 1
fi

shopt -s nullglob
svgs=( *.svg )
if [ ${#svgs[@]} -eq 0 ]; then
  echo "no .svg files found in $(pwd)" >&2
  exit 1
fi

for svg in "${svgs[@]}"; do
  name="${svg%.svg}"
  echo "rendering $svg"
  "$IM" -background none "$svg"                       "$OUT/$name.png"
  "$IM" -background none "$svg" -resize 512x512       "$OUT/$name@512.png"
  "$IM" -background none "$svg" -resize 32x32         "$OUT/$name-favicon.png"
done

echo "done -> $(pwd)/$OUT/"
