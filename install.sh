#!/bin/sh
# Copy this layout and its mods into Herdr's home (live-reloads on save).
set -e
HOME_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME_DIR/layouts" "$HOME_DIR/mods"
# icons.js lives in dendro-files-panel; mods can't import across folders, so others carry a copy.
for m in dendro-diff-panel dendro-editor dendro-quick-open; do
  { echo "// Copy of mods/dendro-files-panel/icons.js (synced by install.sh; edit that one)."; grep -v '^// Copy of' "$here/mods/dendro-files-panel/icons.js"; } > "$here/mods/$m/icons.js"
done
# listnav.js (the panels' list keys) lives in dendro-files-panel; Changes and Agents carry a copy.
for m in dendro-diff-panel dendro-agents-panel; do
  { echo "// Copy of mods/dendro-files-panel/listnav.js (synced by install.sh; edit that one)."; grep -v '^// Copy of' "$here/mods/dendro-files-panel/listnav.js"; } > "$here/mods/$m/listnav.js"
done
# fuzzy.js (quick-open matching) lives in dendro-quick-open; the switcher carries a copy.
{ echo "// Copy of mods/dendro-quick-open/fuzzy.js (synced by install.sh; edit that one)."; grep -v '^// Copy of' "$here/mods/dendro-quick-open/fuzzy.js"; } > "$here/mods/dendro-switcher/fuzzy.js"
for m in "$here"/mods/*/; do
  name="$(basename "$m")"
  dest="$HOME_DIR/mods/$name"
  # A fresh copy each time, so files a newer version dropped go too; editor files stay out.
  if [ -L "$dest" ]; then rm "$dest"; else rm -rf "${dest:?}"; fi
  cp -R "${m%/}" "$dest"
  rm -f "$dest/jsconfig.json" "$dest/gpui-kit.d.ts" "$dest"/*.error
done
for f in "$here"/layouts/*; do
  dest="$HOME_DIR/layouts/$(basename "$f")"
  [ -L "$dest" ] && rm "$dest"
  cmp -s "$f" "$dest" 2>/dev/null || cp "$f" "$dest"
done
# Keys: dendro's section of keys.json goes at the top of yours, once. Only one section is added,
# so it's text, not parsed JSON. Your own bindings still apply: a key in your "terminal" section
# wins over a layout's (Herdr's rule), and a layout's keys only work while it shows.
keys="$HOME_DIR/keys.json"
if [ ! -f "$keys" ]; then
  echo "keys not added: start Herdr once (it writes $keys), then run this again"
elif grep -q '"layout:dendro"' "$keys"; then
  echo "keys: your keys.json already has a layout:dendro section; left as it is"
else
  [ -f "$keys.before-dendro" ] || cp "$keys" "$keys.before-dendro"
  BODY="$(sed '1d;$d' "$here/keys.json")" awk '
    { s = s $0 "\n" }
    END {
      i = index(s, "{"); if (!i) exit 1
      rest = substr(s, i + 1)
      printf "%s\n%s%s%s", substr(s, 1, i), ENVIRON["BODY"], (rest ~ /^[ \t\r\n]*}/ ? "\n" : ","), rest
    }' "$keys" > "$keys.dendro-tmp" && mv "$keys.dendro-tmp" "$keys" \
    && echo "keys: added dendro's shortcuts to $keys (the old file is keys.json.before-dendro)" \
    || { rm -f "$keys.dendro-tmp"; echo "keys not added: $keys isn't a JSON object; copy the bindings in keys.json into it yourself"; }
fi
echo "installed into $HOME_DIR"
