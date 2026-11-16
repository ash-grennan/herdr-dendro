// Files with vscode-icons and per-folder colours. Based on Herdr's shipped `files` mod.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, window, shared, setShared, run, openOverlay, nextCommand, writeTextFile } from "herdr";
import { fileIcon, folderIcon, plainFolder } from "./icons.js";

const INDENT = 16;
// Folder colours come from the theme's bright ANSI colours, picked by name, so `src`
// is the same colour in every project and the palette follows the theme.
const PALETTE = ["ansi12", "ansi13", "ansi14", "ansi10", "ansi11", "ansi9", "ansi4", "ansi5", "ansi6", "ansi3"];
function folderColor(name, t) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return t[PALETTE[h % PALETTE.length]] ?? t.accent;
}
const alpha = (c, a) => /^#[0-9a-f]{6}$/i.test(c) ? c + a : c;
const markColor = (mark, t) => mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked;

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// Makes one new folder (no -p: an existing one is an error, and parents must exist).
async function makeFolder(path, on) {
  const windows = () => exec("powershell", ["-NoProfile", "-Command", "& { param($p) New-Item -ItemType Directory -LiteralPath $p -ErrorAction Stop | Out-Null } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
  let r;
  if (!on && window()?.platform === "windows") r = await windows();
  else {
    try { r = await exec("mkdir", ["--", path], { on }); }
    catch (e) {
      if (!(on && String(e).includes("program not found"))) throw e;
      r = await windows();
    }
  }
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Couldn't create the folder");
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    // New File / New Folder: a name field in the tree, in the folder that was right-clicked.
    this.input = InputState.new({ placeholder: "Name" });
    this.input.on("change", (_e, cx) => { if (this.creating) { this.creating.error = null; cx.notify(); } });
    this.input.on("submit", (_e, cx) => this.create(cx));
    // Closing the menu can move the keyboard away at first; only a later blur on an empty name cancels.
    this.input.on("blur", (_e, cx) => { if (this.creating && Date.now() - this.creating.since > 800 && !this.input.value().trim()) this.cancelCreate(cx); });
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "new-file") this.startCreate(cx, "file");
        else if (c === "new-folder") this.startCreate(cx, "folder");
        cx.notify();
      }
    });
  }

  // Right-click: a folder row targets that folder, a file row its folder, empty space the root.
  openMenu(dir) {
    this.menuDir = dir;
    this.menuContext = this.context;
    openOverlay({ mod: "dendro-files-menu", kind: "popup", at: "pointer", width: 180, height: 72 });
  }

  startCreate(cx, kind) {
    if (this.menuContext !== this.context || !this.root) return;
    const dir = this.menuDir ?? "";
    if (dir && !this.folders.has(dir)) this.toggle(dir, cx);
    this.creating = { kind, dir, since: Date.now(), error: null, busy: false };
    this.input.set_value("");
    this.input.focus();
    cx.timer.after(150, () => this.input.focus());
  }

  cancelCreate(cx) {
    this.creating = null;
    cx.notify();
  }

  create(cx) {
    const creating = this.creating, context = this.context;
    if (!creating || creating.busy) return;
    const name = this.input.value().trim();
    if (!name) return this.cancelCreate(cx);
    const problem = /[\\/]/.test(name) ? "Name can't contain / or \\"
      : name === "." || name === ".." ? "Not a valid name"
      : (this.entries.get(creating.dir) ?? []).some(e => e.name === name) ? `${name} already exists here`
      : null;
    if (problem) { creating.error = problem; cx.notify(); return; }
    const path = creating.dir ? `${creating.dir}/${name}` : name, full = `${this.root}/${path}`;
    creating.busy = true;
    cx.spawn(async cx => {
      try {
        if (creating.kind === "folder") await makeFolder(full, this.on);
        else if (this.on) {
          // noclobber: never truncate a file that appeared since the folder was listed.
          const r = await exec("sh", ["-c", 'set -C; : > "$1"', "new-file", full], { on: this.on });
          if (r.code !== 0) throw new Error(r.stderr.trim() || "Couldn't create the file");
        } else await writeTextFile(full, "", null);
        if (this.creating === creating) this.creating = null;
        if (!this.current(context)) return;
        await this.loadFolder(creating.dir, context).catch(() => {});
        if (creating.kind === "folder") { if (!this.folders.has(path)) this.toggle(path, cx); } // open it, ready for its first file
        else this.show(path, cx);
        this.refresh(cx); // git marks
      } catch (e) {
        creating.busy = false;
        if (this.creating === creating) creating.error = String(e?.message ?? e);
      } finally { cx.notify(); }
    });
  }

  newFileRow(depth, t) {
    const c = this.creating, typed = this.input.value().trim();
    return v_flex().id("files-new").flex_none()
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); this.cancelCreate(cx); } })
      .child(h_flex().h(26).pl(8 + depth * INDENT).pr(8).gap(6).items_center()
        .child(div().w(12).flex_none())
        .child(c.kind === "folder" ? svg(plainFolder(false)).size(16).flex_none().text_color(folderColor(typed, t)) : image(fileIcon(typed || "untitled")).size(16).flex_none())
        .child(Input.new(this.input).flex_1().min_w(0).h(22).px(6).rounded(5).border_1().border_color(c.error ? t.ansi1 : t.accent).bg(t.background).text_size(13).text_color(t.foreground)))
      .when(Boolean(c.error), el => el.child(div().pl(8 + depth * INDENT + 36).pr(8).pb(4).text_size(11.5).text_color(t.ansi1).child(c.error)));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.watched = null; this.error = null; this.limited = false;
      this.loading = false; this.creating = null;
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  // Files open in the editor in the main area (the dendro-editor mod), not in this panel.
  show(path, cx) {
    if (!path || !cx) return;
    // The editor keeps each space's open files apart, so say which space this is for.
    setShared("dendro.open", { path: `${this.root}/${path}`, on: this.on ?? null, space: spaces().find(s => s.active)?.id ?? "", at: Date.now() });
    run("layout.select", { stack: "center", child: "editor" });
  }

  // guides: the colour of each open ancestor folder, drawn as a thin line down its children.
  rows(prefix, depth, out, t, guides = []) {
    if (out.length >= TOTAL || depth > 40) return out;
    if (this.creating?.dir === prefix) out.push(this.newFileRow(depth, t));
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      const color = entry.dir ? folderColor(entry.name, t) : null, typed = entry.dir && folderIcon(entry.name, open);
      const icon = !entry.dir ? image(fileIcon(entry.name)).size(16).flex_none()
        : typed ? image(typed).size(16).flex_none()
        : svg(plainFolder(open)).size(16).flex_none().text_color(color);
      const editing = !entry.dir && this.opened === `${this.root}/${path}`;
      out.push(h_flex().id(`file-${path}`).relative().when(editing, el => el.bg(t.selected)).h(26).flex_none().pl(8 + depth * INDENT).pr(8).gap(6).items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(entry.dir ? path : prefix); })
        .children(guides.map((c, i) => div().absolute().top(0).bottom(0).left(8 + i * INDENT + 5.5).w(1).bg(alpha(c, "66"))))
        .child(entry.dir ? svg(`mods/dendro-files-panel/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(open ? color : t.dim) : div().w(12).flex_none())
        .child(icon)
        .child(div().flex_1().min_w(0).truncate().when(entry.dir, el => el.text_color(color).font_medium()).when(!entry.dir && Boolean(mark), el => el.text_color(markColor(mark, t))).child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(markColor(mark, t)).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t, [...guides, color]);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    const request = shared("dendro.open"); // the file the editor last opened in this space, for the row highlight
    this.opened = request && request.space === spaces().find(s => s.active)?.id ? request.path : null;
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.root?.split(/[\\/]/).pop() ?? ""))
        .child(div().id("files-find").size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(`Go to file (${window()?.platform === "macos" ? "⌘P" : "Alt+P"})`)
          .on_click(() => run("mod.open", { name: "dendro-quick-open" }))
          .child(svg("mods/workspace-chrome/search.svg").size(14))))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .on_mouse_down("right", (_e, cx) => { if (this.root) this.openMenu(""); })
        .children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total"))));
  }
}
