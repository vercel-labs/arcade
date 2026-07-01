#!/usr/bin/env sh
# Render a snapshot AND convert it to a PNG in one step — the two-command ritual
# (snapshot → sips) collapsed into `pnpm snapshot:png ...`. All args pass straight
# through to snapshot.ts; we read back the .ppm path it prints and run sips on it,
# so every subcommand and custom out path is handled without special-casing.
#
#   pnpm snapshot:png 140 50 0.7            # prism → .snapshots/prism.png
#   pnpm snapshot:png setup 120 40          # any subcommand works
set -e

log=$(tsx src/tools/snapshot.ts "$@")
echo "$log"
ppm=$(printf '%s\n' "$log" | sed -n 's/^wrote \(.*\) (.*)$/\1/p' | tail -1)
[ -n "$ppm" ] || { echo "snapshot:png: no .ppm produced (nothing to convert)" >&2; exit 1; }

png="${ppm%.ppm}.png"
sips -s format png "$ppm" --out "$png" -Z 1000 >/dev/null
echo "png: $png"
