// Quick open: type part of a file's name or path, Enter opens it in the Editor (dendro-editor).
// Opened by its key (keys.json in this repo: Alt+P, Cmd+P on macOS) or the search button in Files.
// Lists the files of the repo you're in (git's list: tracked and new, not ignored), else of the
// folder (skipping dependency and build folders). Empty, it shows the files you opened last.
// ↑/↓ move, Enter opens, Esc closes.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, run, theme, props, closeOverlay, setShared, checking, window, home } from "herdr";
import { fileIcon } from "./icons.js";
// A file's icon: its glyph, tinted by its type.
const fileGlyph = (name, t, size) => { const f = fileIcon(name); return svg(f.path).size(size).flex_none().text_color(t[f.color] ?? t.muted); };
import { score } from "./fuzzy.js";

const MAX_FILES = 50000, SHOWN = 200, ROW = 30, RECENT = 30, FIT = 12; // FIT: rows on show at once
// Not worth listing outside git: folders of dependencies, builds and tool state.
const SKIP = ["node_modules", ".git", ".terraform", ".terragrunt-cache", ".venv", "venv", "__pycache__", "dist", "build", "target", ".next", ".cache", "vendor", "cdk.out", ".serverless", ".aws-sam"];

// Where you are, as the Files panel works it out: the focused pane's folder, else the space's.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id ?? "" };
}

async function listFiles(cwd, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
  if (top?.code === 0 && top.stdout.trim()) {
    const root = top.stdout.trim();
    const r = await exec("git", ["--no-optional-locks", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate"], { cwd: root, on });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "git ls-files failed");
    const all = r.stdout.split("\0").filter(Boolean);
    return { root, files: all.slice(0, MAX_FILES), git: true, more: all.length > MAX_FILES };
  }
  if (!on && window()?.platform === "windows") return { root: cwd, files: [], git: false };
  const prune = SKIP.map((d) => `-name '${d}'`).join(" -o ");
  const script = `cd "$1" && find . \\( ${prune} \\) -prune -o -type f -print0 2>/dev/null | head -c 8000000`;
  const r = await exec("sh", ["-c", script, "quick-open", cwd], { on });
  // Cut by head: the list stops short, and its last path may be half of one.
  const whole = !r.stdout || r.stdout.endsWith("\0");
  const all = r.stdout.split("\0").filter(Boolean).map((p) => p.replace(/^\.\//, ""));
  if (!whole) all.pop();
  return { root: cwd, files: all.slice(0, MAX_FILES), git: false, more: !whole || all.length > MAX_FILES };
}

export default class QuickOpen extends View {
  init(_props, cx) {
    this.query = "";
    this.at = 0;
    this.top = 0;
    this.files = null;
    this.error = null;
    this.where = location();
    try { this.recentBy = JSON.parse(localStorage.getItem("recent") ?? "{}") ?? {}; } catch { this.recentBy = {}; }
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Go to file…" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.at = 0; this.top = 0; this.results = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.open(this.list()[this.at]));
    this.input.focus();
    cx.timer.after(150, () => this.input.focus());
    if (checking() || !this.where.cwd) return;
    cx.spawn(async (cx) => {
      try {
        const got = await listFiles(this.where.cwd, this.where.on);
        this.root = got.root; this.files = got.files; this.git = got.git; this.more = got.more; this.byDepth = null;
      } catch (e) { this.error = String(e?.message ?? e); this.files = []; }
      this.results = null;
      cx.notify();
    });
  }

  close() { closeOverlay(props()?.overlay); }

  recent() {
    const known = new Set(this.files ?? []);
    return (this.recentBy[`${this.where.on ?? ""}\0${this.root}`] ?? []).filter((p) => known.has(p));
  }

  // The rows: the best matches, or with nothing typed your recent files, then the rest in order.
  list() {
    if (this.results) return this.results;
    const files = this.files ?? [];
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      const recent = this.recent(), seen = new Set(recent);
      // Then the rest, top-level files first.
      const depth = (p) => p.split("/").length;
      this.byDepth ??= [...files].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
      this.results = [...recent.map((path) => ({ path, recent: true })), ...this.byDepth.filter((p) => !seen.has(p)).slice(0, SHOWN - recent.length).map((path) => ({ path }))];
    } else {
      const scored = [];
      for (const path of files) {
        const s = score(words, path);
        if (s >= 0) scored.push({ path, s });
      }
      scored.sort((a, b) => b.s - a.s || a.path.localeCompare(b.path));
      this.matches = scored.length;
      this.results = scored.slice(0, SHOWN);
    }
    return this.results;
  }

  open(row) {
    if (!row || !this.root) return;
    const key = `${this.where.on ?? ""}\0${this.root}`;
    this.recentBy[key] = [row.path, ...(this.recentBy[key] ?? []).filter((p) => p !== row.path)].slice(0, RECENT);
    const keys = Object.keys(this.recentBy);
    if (keys.length > 50) delete this.recentBy[keys[0]];
    try { localStorage.setItem("recent", JSON.stringify(this.recentBy)); } catch {}
    this.close();
    // The editor keeps each space's files apart, so say which space this is for.
    setShared("dendro.open", { path: `${this.root}/${row.path}`, on: this.where.on ?? null, space: this.where.space, at: Date.now() });
    run("layout.select", { stack: "center", child: "editor" });
  }

  render() {
    const t = theme();
    const rows = this.list();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    // FIT rows at a time (the popup is as tall as what's in it); the window follows the selection.
    const fit = FIT;
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + fit) this.top = this.at - fit + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, rows.length - fit)));
    const move = (to, cx) => { if (rows.length) { this.at = (to + rows.length) % rows.length; cx.notify(); } };
    const words = this.query.trim();
    const note = this.error ? this.error
      : this.files === null ? (this.where.cwd ? "Listing files…" : "No folder here")
      : !this.files.length ? (this.git === false && window()?.platform === "windows" ? "Not a git repository" : "No files")
      : !rows.length ? "No matching files"
      : null;
    // A + when there are more files than were listed (MAX_FILES, or find's output cut short).
    const total = this.files === null ? "" : `${this.files.length}${this.more ? "+" : ""}`;
    const count = this.files === null ? "" : words ? `${this.matches ?? 0} of ${total}` : `${total} files`;

    const row = (r, i) => {
      const slash = r.path.lastIndexOf("/"), name = r.path.slice(slash + 1), dir = slash >= 0 ? r.path.slice(0, slash) : "";
      return h_flex().id(`qo-${i}`).h(ROW).flex_none().px(10).gap(9).items_center().rounded(7).cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click(() => this.open(r))
        .child(fileGlyph(name, t, 16))
        .child(div().flex_none().max_w(260).truncate().text_color(t.foreground).child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(dir))
        .when(Boolean(r.recent), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("recent")));
    };

    return v_flex().id("quick-open").track_focus(this.handle).w_full().min_h(0).p(14).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); return this.close(); }
        if (e.key === "down" || (e.modifiers.control && e.key === "n")) move(this.at + 1, cx);
        else if (e.key === "up" || (e.modifiers.control && e.key === "p")) move(this.at - 1, cx);
        else if (e.key === "pagedown") move(Math.min(rows.length - 1, this.at + fit), cx);
        else if (e.key === "pageup") move(Math.max(0, this.at - fit), cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(count)))
      .child(v_flex().id("qo-list").h(Math.max(1, Math.min(fit, rows.length)) * ROW).flex_none().overflow_hidden()
        .on_scroll_wheel((e, cx) => {
          const by = e.delta.y < 0 ? 1 : e.delta.y > 0 ? -1 : 0;
          if (!by) return;
          this.top = Math.max(0, Math.min(this.top + by, Math.max(0, rows.length - fit)));
          this.at = Math.max(this.top, Math.min(this.at, this.top + fit - 1));
          cx.notify();
        })
        .when(Boolean(note), (el) => el.child(div().px(10).py(6).text_color(t.dim).child(note)))
        .children(rows.slice(this.top, this.top + fit).map((r, k) => row(r, this.top + k))))
      .child(h_flex().flex_none().gap(14).text_size(11).text_color(t.dim)
        .child("↑↓ move").child("Enter open").child("Esc close")
        .child(div().flex_1())
        .child(div().max_w(280).truncate().child(this.pretty(this.root ?? ""))));
  }

  // The folder in the footer: ~ for the home folder, as elsewhere (this computer only).
  pretty(p) {
    const h = home();
    return !this.where?.on && h && (p === h || p.startsWith(h + "/")) ? "~" + p.slice(h.length) : p;
  }
}
