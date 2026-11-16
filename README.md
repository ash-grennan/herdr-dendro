# herdr-dendro

A [Herdr](https://herdr.dev) layout based on the default one, with **Changes** and **Files** stacked on the right (both visible at once), and a Files panel with vscode-icons file icons, coloured folders and indent guides.

- `layouts/dendro.json`: the layout
- `mods/dendro-diff-panel/`: Changes panel; click a file to swap the panel to its git diff (Esc / ‹ back, ↑↓ or j/k between files)
- `mods/dendro-files-panel/`: Files panel with icons and folder colours; right-click for **New File** and **New Folder**
- `mods/dendro-files-menu/`: the Files panel's right-click menu
- `mods/dendro-tab-bar/`: tab bar with the Chat | Editor switch and the Terminal / Files / Changes buttons
- `mods/dendro-editor/`: the Editor view: files opened from Files, as tabs; markdown opens rendered (Preview | Edit), and prose wraps
- `mods/dendro-agents-panel/`: Agents list grouped into colour-coded folder boxes (the agent's git repo, else its folder); it also names a space after its first agent's folder, unless you named the space yourself
- `mods/dendro-status-bar/`: the bottom status bar, plus your Claude plan limits (5-hour and weekly)

Install: `./install.sh`, then pick **dendro** with `ctrl-shift-l`.

### Claude limits (optional)

The status bar shows your Claude plan limits once Claude Code is told to report them. Add this to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.config/herdr-app/mods/dendro-status-bar/claude-statusline.py" }
```

Claude Code then runs that script (needs `python3`) after each response. It prints the limits under each chat and saves them to `~/.cache/herdr-dendro/claude-limits.json`, which the status bar reads. It only has numbers when you are signed in with a Claude subscription, and they update when a session gets a response.

## License

MIT, see `LICENSE`. This covers the layout, the mods' code and the original SVGs (`changes.svg`, `win-*.svg`).

### Third-party assets

- **[vscode-icons](https://github.com/vscode-icons/vscode-icons)**, MIT, notice in `mods/dendro-files-panel/icons/LICENSE-vscode-icons.txt`. Covers everything in `mods/dendro-files-panel/icons/`, plus `folder.svg` and `folder-open.svg` in that mod and in `mods/dendro-agents-panel/` (recoloured copies of its default folder icons; notice copied there too).
- **[Lucide](https://lucide.dev)**, ISC (some icons MIT via Feather), notice in `LICENSE-lucide.txt` inside each mod that uses them: `chevron-*.svg`, `x.svg`, `terminal.svg`, `sort-folder.svg`, `file-plus.svg`, `folder-plus.svg`.

Product and language logos among the file icons are trademarks of their owners and are used only to label file types.
