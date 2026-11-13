#!/bin/sh
# Copy this layout and its mods into Herdr's home (live-reloads on save).
set -e
command -v rsync >/dev/null || { echo "install.sh needs rsync" >&2; exit 1; }
HOME_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME_DIR/layouts" "$HOME_DIR/mods"
# icons.js lives in dendro-files-panel; mods can't import across folders, so others carry a copy.
for m in dendro-diff-panel dendro-editor; do
  { echo "// Copy of mods/dendro-files-panel/icons.js (synced by install.sh; edit that one)."; grep -v '^// Copy of' "$here/mods/dendro-files-panel/icons.js"; } > "$here/mods/$m/icons.js"
done
for m in "$here"/mods/*/; do
  name="$(basename "$m")"
  [ -L "$HOME_DIR/mods/$name" ] && rm "$HOME_DIR/mods/$name"
  rsync -a --delete --exclude jsconfig.json --exclude gpui-kit.d.ts --exclude "*.error" "$m" "$HOME_DIR/mods/$name/"
done
for f in "$here"/layouts/*; do
  dest="$HOME_DIR/layouts/$(basename "$f")"
  [ -L "$dest" ] && rm "$dest"
  cmp -s "$f" "$dest" 2>/dev/null || cp "$f" "$dest"
done
echo "installed into $HOME_DIR"
