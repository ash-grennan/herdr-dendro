# herdr-dendro

A [Herdr](https://herdr.dev) layout for working with several coding agents at once: agents grouped by project in the sidebar, **Changes** and **Files** side by side on the right, and an editor, quick open and a project switcher built in.

<!-- Screenshots go here. -->

## Features

**Agents panel** (the sidebar)
- Agents grouped into colour-coded boxes by project (the git repo, else the folder); no two boxes share a colour
- The box holding the space you're in is highlighted; the sidebar also replaces Herdr's Spaces list
- Spaces are named after their first agent's folder, unless you named them yourself
- Right-click an agent to start a new session of the same agent in the same folder
- Right-click a box for its space's menu: rename, worktrees, close
- Spaces with no agents are listed under **No agents**
- **Projects**: add a folder (such as `~/code`) and every git repo directly inside it is listed, most recently committed first. Click one to open it; right-click it to start any installed agent there
- Sort by folder, priority or space

**Tabs**
- Tabs take their agent's session title (up to 12 characters) unless you named them
- Each agent's tab is bordered in its project's colour, so you can tell at a glance which project you're in
- A shell strip above each agent's chat, toggled with the **Terminal** button (kept at least 4 rows tall so prompt glyphs draw properly)
- **Chat | Editor** switch, and buttons to show or hide Files and Changes

**Files and Changes**
- Files panel with vscode-icons, coloured folders, indent guides and git status marks
- Right-click in Files for **New File** and **New Folder**
- Changes panel with per-file diffs; click a line in a diff to edit it in place
- Commit from the Changes panel

**Editor**
- Opens files from Files or quick open, as tabs, one set of tabs per space
- Syntax highlighting; Markdown opens rendered, with **Preview | Edit**; prose wraps
- Reloads when an agent changes the file on disk, and asks before overwriting if you've edited it too

**Quick open and switcher**
- **Quick open**: fuzzy-find any file in the repo (git's file list, ignored files left out) and open it in the editor; recent files first
- **Switcher**: jump to a project or one of its 3 most recent sessions; the likeliest match is picked as you type, and with nothing typed it picks the project you were in before this one

**Status bar**
- Machine, branch and agent count, plus your Claude plan limits (5-hour and weekly; optional setup below)

## Keyboard shortcuts

Shortcuts added by this layout (only while dendro is showing; macOS in brackets):

| Keys | Does |
|---|---|
| `Alt+P` (`⌘P`) | Quick open a file |
| `Alt+O` (`⌘O`) | Switch to a project or session |

In the popups:

| Keys | Does |
|---|---|
| `↑` `↓` / `Ctrl+N` `Ctrl+P` | Move |
| `Alt+↑` `Alt+↓` | Switcher: jump between projects, skipping sessions |
| `Page Up` `Page Down` | Quick open: move a page |
| `Enter` | Open / go |
| `Esc` | Close |

In the panels:

| Keys | Does |
|---|---|
| `Ctrl+S` (`⌘S`) | Editor: save |
| `Ctrl+W` (`⌘W`) | Editor: close the tab |
| `↑` `↓` or `j` `k` | Changes: previous / next file while a diff is open |
| `Esc` | Changes: back to the file list |
| `Enter` | Changes: save the line you're editing |
| `Shift+Enter` | Changes: save the line and add one below |
| `↑` `↓` `Enter` `Esc` | Right-click menus |

Herdr's own shortcuts still apply, for example `Ctrl+Shift+L` to switch layout and `Ctrl+Shift+P` for the command palette.

## Install

Needs Herdr 0.1.16 and `rsync`.

```sh
./install.sh
```

Then press `Ctrl+Shift+L` and pick **dendro**.

- Copies the layout and the `dendro-*` mods into `~/.config/herdr-app` (or `$HERDR_APP_HOME`), replacing any installed copies; run it again after pulling.
- Adds the shortcuts above to your `~/.config/herdr-app/keys.json` (needs `python3`), skipping any key you already use. Herdr then treats the keys file as yours, so new default shortcuts in later Herdr versions have to be added by hand.
- Uses icons and popups from Herdr's own mods, so a later Herdr that renames those can break it.

**Uninstall:** pick another layout, delete `layouts/dendro.json` and the `mods/dendro-*` folders from `~/.config/herdr-app`, and remove the `layout:dendro` section from its `keys.json`.

### Claude limits (optional)

To show your Claude plan limits in the status bar, add this to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.config/herdr-app/mods/dendro-status-bar/claude-statusline.py" }
```

- This replaces any `statusLine` you already have (Claude Code has only one).
- The script needs `python3`. It prints the limits under each chat and saves them to `~/.cache/herdr-dendro/claude-limits.json` for the status bar.
- Limits only show when you're signed in with a Claude subscription, and they update when a session gets a response.

## License

MIT, see `LICENSE`. This covers the layout, the mods' code and the original SVGs (`changes.svg`, `win-*.svg`).

### Third-party assets

- **[vscode-icons](https://github.com/vscode-icons/vscode-icons)**, MIT, notice in `mods/dendro-files-panel/icons/LICENSE-vscode-icons.txt`. Covers everything in `mods/dendro-files-panel/icons/`, plus `folder.svg` and `folder-open.svg` in that mod and in `mods/dendro-agents-panel/` (recoloured copies of its default folder icons; notice copied there too).
- **[Lucide](https://lucide.dev)**, ISC (some icons MIT via Feather), notice in `LICENSE-lucide.txt` inside each mod that uses them: `chevron-*.svg`, `x.svg`, `terminal.svg`, `sort-folder.svg`, `file-plus.svg`, `folder-plus.svg`.

Product and language logos among the file icons are trademarks of their owners and are used only to label file types.
