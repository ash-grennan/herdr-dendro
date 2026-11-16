// Switcher: go to an agent folder or one of its sessions. Opened by its key (keys.json in this
// repo: Alt+O, Cmd+O on macOS) or the search button in the Agents panel. Lists the Agents panel's
// folder boxes, most recently active first, each with its latest sessions under it, then the
// Projects repos. Typing picks the likeliest folder; with nothing typed, the folder you were in
// before this one is picked. Enter on a folder goes to its latest session.
// The list comes from the Agents panel (dendro-agents-panel), which shares it as "dendro.switcher".
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, run, theme, props, closeOverlay, shared, home, window } from "herdr";
import { score } from "./fuzzy.js";

const ROW = 28, FIT = 14;  // FIT: rows on show at once (the popup is as tall as what's in it)

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
const within = (p, dir) => Boolean(p) && (p === dir || p.startsWith(dir + "/"));
const alpha = (c, a) => /^#[0-9a-f]{6}$/i.test(c ?? "") ? c + a : c;

export default class Switcher extends View {
  init(_props, cx) {
    this.query = "";
    this.at = null;   // picked when the rows are first known
    this.top = 0;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Go to a folder or session…" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.at = null; this.top = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.rows()[this.at ?? 0]));
    this.input.focus();
    cx.timer.after(150, () => this.input.focus());
  }

  close() { closeOverlay(props()?.overlay); }

  // Folders and projects, best first, each folder followed by its sessions.
  rows() {
    const data = shared("dendro.switcher") ?? {}, h = home();
    const pretty = (p) => h && within(p, h) ? "~" + p.slice(h.length) : p;
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const rank = (item, sessions, penalty) => {
      if (!words.length) return 0;
      // The folder's own name matches loosely and counts most; its path and its sessions' names
      // only when they contain what's typed (letters strewn through a long title match anything).
      const has = (text) => words.every((w) => text.toLowerCase().includes(w));
      const byName = score(words, item.name);
      const best = Math.max(
        byName < 0 ? -1 : byName + 40,
        has(item.path) ? Math.max(0, score(words, pretty(item.path)) - 10) : -1,
        ...sessions.map((s) => (has(s.label ?? "") ? Math.max(0, score(words, s.label) - 20) : -1)),
      );
      return best < 0 ? -1 : best - penalty;
    };
    const items = [
      ...(data.folders ?? []).map((f) => ({ kind: "folder", ...f, s: rank(f, f.sessions ?? [], 0) })),
      ...(data.projects ?? []).map((p) => ({ kind: "project", ...p, s: rank(p, [], 15) })),
    ].filter((x) => x.s >= 0);
    // Typed: best match first. Not: folders by latest activity, then projects by latest commit.
    items.sort((a, b) => words.length ? b.s - a.s || b.at - a.at : (a.kind === b.kind ? b.at - a.at : a.kind === "folder" ? -1 : 1));
    const out = [];
    for (const it of items) {
      out.push({ ...it, parent: pretty(it.path).replace(/\/[^/]*$/, "") });
      if (it.kind === "folder") for (const s of it.sessions ?? []) out.push({ kind: "session", ...s, color: it.color });
    }
    return out;
  }

  go(r) {
    if (!r) return;
    this.close();
    if (r.kind === "session") return run("pane.focus", { pane: r.pane });
    if (r.kind === "folder") { if (r.sessions?.[0]) run("pane.focus", { pane: r.sessions[0].pane }); return; }
    // A project: the space open there, else a new one.
    const all = panes();
    const where = (sp) => { const tabs = new Set((sp.tabs ?? []).map((c) => c.id)); return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || sp.folder; };
    const sp = spaces().find((s) => !s.machine && within(where(s), r.path));
    if (sp) run("space.select", { id: sp.id });
    else run("space.new", { folder: r.path, machine: "" });
  }

  render() {
    const t = theme(), now = Date.now();
    const rows = this.rows();
    const pickable = (i) => rows[i] && rows[i].kind !== "session";
    if (this.at === null) {
      // The likeliest folder: the best match, or (nothing typed) the latest one you're not in now.
      // Another folder only: never a project, which Enter would open a new space for.
      const heads = rows.map((r, i) => (r.kind === "session" ? -1 : i)).filter((i) => i >= 0);
      const folders = heads.filter((i) => rows[i].kind === "folder");
      const here = rows.find((r) => r.kind === "folder" && r.sessions?.some((s) => s.focused));
      this.at = (!this.query.trim() && here && here === rows[folders[0]] && folders.length > 1 ? folders[1] : heads[0]) ?? 0;
    }
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + FIT) this.top = this.at - FIT + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, rows.length - FIT)));
    const move = (to, cx) => { if (rows.length) { this.at = (to + rows.length) % rows.length; cx.notify(); } };
    // Ctrl/Alt+↑↓ jump between folders, skipping their sessions.
    const jump = (by, cx) => {
      if (!rows.length) return;
      let i = this.at;
      do i = (i + by + rows.length) % rows.length; while (!pickable(i) && i !== this.at);
      this.at = i; cx.notify();
    };

    const status = (st) => st === "working" ? svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)
      : st === "blocked" ? div().flex_none().text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")
      : st === "done" ? div().size(7).mx(3).flex_none().rounded(4).bg(t.done ?? t.dim)
      : div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    const row = (r, i) => {
      const on = i === this.at, color = t[r.color] ?? t.accent;
      const base = h_flex().id(`sw-${i}`).h(ROW).flex_none().gap(8).items_center().rounded(7).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click(() => this.go(r));
      if (r.kind === "session") {
        const pic = r.icon ? (r.tint ? svg(r.icon).size(14).flex_none().text_color(t.foreground) : image(r.icon).size(14).flex_none()) : div().w(14).flex_none();
        return base.pl(34).pr(10)
          .child(pic)
          .child(div().flex_1().min_w(0).truncate().text_color(r.focused ? t.foreground : t.muted).child(r.label || "session"))
          .when(r.at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(now - r.at))))
          .child(status(r.status));
      }
      const project = r.kind === "project";
      return base.px(10)
        .child(svg("mods/dendro-agents-panel/folder.svg").size(15).flex_none().text_color(project ? alpha(color, "8c") : color))
        .child(div().flex_none().max_w(220).truncate().font_semibold().text_color(project ? t.muted : color).child(r.name))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(r.parent))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(project ? "project" : `${r.count} session${r.count === 1 ? "" : "s"}`))
        .when(r.at > 0, (el) => el.child(div().flex_none().w(28).text_right().text_size(11).text_color(t.dim).child(ago(now - r.at))));
    };
    const data = shared("dendro.switcher");
    const note = !data ? "Nothing yet: this list comes from the Agents panel"
      : !rows.length ? (this.query.trim() ? "No matching folders" : "No agents or projects yet") : null;

    return v_flex().id("switcher").track_focus(this.handle).w_full().min_h(0).p(14).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const m = e.modifiers;
        if (e.key === "escape") { cx.stop_propagation(); return this.close(); }
        if ((e.key === "down" || e.key === "up") && (m.control || m.alt)) jump(e.key === "down" ? 1 : -1, cx);
        else if (e.key === "down" || (m.control && e.key === "n")) move(this.at + 1, cx);
        else if (e.key === "up" || (m.control && e.key === "p")) move(this.at - 1, cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground)))
      .child(v_flex().id("sw-list").h(Math.max(1, Math.min(FIT, rows.length)) * ROW).flex_none().overflow_hidden()
        .on_scroll_wheel((e, cx) => {
          const by = e.delta.y < 0 ? 1 : e.delta.y > 0 ? -1 : 0;
          if (!by) return;
          this.top = Math.max(0, Math.min(this.top + by, Math.max(0, rows.length - FIT)));
          this.at = Math.max(this.top, Math.min(this.at, this.top + FIT - 1));
          cx.notify();
        })
        .when(Boolean(note), (el) => el.child(div().px(10).py(6).text_color(t.dim).child(note)))
        .children(rows.slice(this.top, this.top + FIT).map((r, k) => row(r, this.top + k))))
      .child(h_flex().flex_none().gap(14).text_size(11).text_color(t.dim)
        .child("↑↓ move").child(`${window()?.platform === "macos" ? "⌥" : "Alt+"}↑↓ folders`).child("Enter go").child("Esc close"));
  }
}
