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
- Files panel with file-type icons coloured by type, coloured folders, indent guides and git status marks
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

## Keyboard

Everything in dendro can be reached from the keyboard. Shortcuts apply only while dendro is showing (macOS in brackets).

**Leader: `Ctrl+Space`, then one key.** A popup lists the keys; `Esc` closes it.

| Key | Does | | Key | Does |
|---|---|---|---|---|
| `a` | Agents (sidebar) | | `p` | Quick open a file |
| `f` | Files | | `o` | Switch project |
| `g` | Changes | | `[` `]` | Back / forward |
| `c` | Chat | | `n` | New tab |
| `e` | Chat ⇄ Editor | | `b` | Sidebar |
| `t` | Terminal strip | | `,` `?` | Settings, all keys |

`a`, `f`, `g` and `e` give that panel the keyboard, showing it first if it's hidden. `Ctrl+Space` is taken from terminals while dendro shows; it's the NUL character in a shell, which few programs use.

**Direct keys** for the most frequent jumps:

| Keys | Does |
|---|---|
| `Alt+P` (`⌘P`) | Quick open a file |
| `Alt+O` (`⌘O`) | Switch to a project or session |
| `Alt+←` `Alt+→` | Back / forward through the places you've been (space, tab, Chat or Editor) |

`Alt+←` `Alt+→` move between panes elsewhere in Herdr; in dendro, `Alt+H` `Alt+L` still do, and they also step into the Agents, Files and Changes panels.

**In a panel** (Agents, Files, Changes), the same keys everywhere. An accent bar marks the row you're on:

| Keys | Does |
|---|---|
| `↑` `↓` or `j` `k` | Move |
| `Home` `End` or `g` `G` | First / last |
| `Page Up` `Page Down` | Move a page |
| `→` or `l` | Unfold (a folder, box or section), or step into it |
| `←` or `h` | Fold, or go up to the parent |
| `Enter` | Open: an agent's chat, a space, a project, a file (in the editor), a change's diff |
| `m` or `Shift+F10` | The row's right-click menu |
| `Esc` | Back to the chat |

Files: `Space` opens a file and keeps the keyboard in Files. Changes: `c` goes to the commit message; in a diff, `j` `k` move between files, and `h` or `Esc` goes back to the list.

**Elsewhere:**

| Keys | Does |
|---|---|
| `↑` `↓` / `Ctrl+N` `Ctrl+P` | Popups: move (`j` `k` too in right-click menus) |
| `Alt+↑` `Alt+↓` | Switcher: jump between projects, skipping sessions |
| `Ctrl+S` (`⌘S`) / `Ctrl+W` (`⌘W`) | Editor: save / close the tab |
| `Esc` | Editor: back to the chat (from a Markdown preview or an empty editor) |
| `Enter` / `Shift+Enter` | Changes: save the line you're editing / and add one below |

Herdr's own shortcuts still apply, for example `Ctrl+Shift+L` to switch layout and `Ctrl+Shift+P` for the command palette.

## Install

Needs Herdr 0.1.16 and `rsync`.

```sh
./install.sh
```

Then press `Ctrl+Shift+L` and pick **dendro**.

- Copies the layout and the `dendro-*` mods into `~/.config/herdr-app` (or `$HERDR_APP_HOME`), replacing any installed copies; run it again after pulling.
- Adds the shortcuts above to your `~/.config/herdr-app/keys.json` (needs `python3`), skipping any key you already use in dendro or in terminals (a key Herdr binds everywhere, such as `Alt+←`, does the dendro thing only while dendro shows). Herdr then treats the keys file as yours, so new default shortcuts in later Herdr versions have to be added by hand.
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

- **[Lucide](https://lucide.dev)**, ISC (some icons MIT via Feather), notice in `LICENSE-lucide.txt` inside each mod that ships them: everything in `mods/dendro-files-panel/icons/` (the file-type icons), plus `folder.svg`, `folder-open.svg`, `chevron-*.svg`, `x.svg`, `terminal.svg`, `sort-folder.svg`, `file-plus.svg` and `folder-plus.svg`.

The file icons are plain glyphs tinted with the theme's colours; no product or language logos are included.
