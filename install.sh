#!/bin/sh
# Copy this layout and its mods into Herdr's home (live-reloads on save).
set -e
command -v rsync >/dev/null || { echo "install.sh needs rsync" >&2; exit 1; }
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
  [ -L "$HOME_DIR/mods/$name" ] && rm "$HOME_DIR/mods/$name"
  rsync -a --delete --exclude jsconfig.json --exclude gpui-kit.d.ts --exclude "*.error" "$m" "$HOME_DIR/mods/$name/"
done
for f in "$here"/layouts/*; do
  dest="$HOME_DIR/layouts/$(basename "$f")"
  [ -L "$dest" ] && rm "$dest"
  cmp -s "$f" "$dest" 2>/dev/null || cp "$f" "$dest"
done
# Keys (keys.json): added to yours, never replacing a key you already use.
if [ ! -f "$HOME_DIR/keys.json" ] || ! command -v python3 >/dev/null; then
  echo "keys not added: copy the bindings in keys.json into $HOME_DIR/keys.json yourself"
else
  python3 - "$here/keys.json" "$HOME_DIR/keys.json" <<'PY'
import json, sys
ours, path = json.load(open(sys.argv[1])), sys.argv[2]
with open(path) as f:
    yours = json.load(f)
changed = False
for section, binds in ours.items():
    mine = yours.setdefault(section, {})
    # A layout's keys only apply while it shows, so they may take over a global key there.
    layout = section.startswith("layout:")
    for key, action in binds.items():
        used = [s for s in ((section, "terminal") if layout else (section, "global", "terminal")) if key in yours.get(s, {})]
        if mine.get(key) == action:
            continue
        if used:
            print(f"keys: {key} left as it is ({used[0]} has it); bind {action} to another key in {path} if you want it")
            continue
        mine[key] = action
        changed = True
        instead = yours.get("global", {}).get(key) if layout else None
        print(f"keys: {key} -> {action}" + (f" (instead of {instead} while {section[7:]} shows)" if instead else ""))
if changed:
    with open(path, "w") as f:
        json.dump(yours, f, indent=2, ensure_ascii=False)
        f.write("\n")
PY
fi
echo "installed into $HOME_DIR"
