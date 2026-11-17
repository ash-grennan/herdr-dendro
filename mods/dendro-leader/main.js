// Leader: press its key (keys.json in this repo: Ctrl+Space), then one letter. This popup lists
// the letters; Esc or a click outside closes it. Panel and view keys go to the tab bar
// (dendro-tab-bar), which shows and focuses things; the rest are Herdr commands.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, theme, props, closeOverlay, openOverlay } from "herdr";

const ask = (cmd) => () => run(`dendro-tab-bar.${cmd}`);
// Columns of groups of { key, label, go }; `keys`: what e.key may be for it, when not just `key`.
const COLUMNS = [
  [
    { head: "Go to", items: [
      { key: "a", label: "Agents", go: ask("agents") },
      { key: "f", label: "Files", go: ask("files") },
      { key: "g", label: "Changes", go: ask("changes") },
      { key: "c", label: "Chat", go: ask("chat") },
      { key: "e", label: "Chat ⇄ Editor", go: ask("view") },
      { key: "t", label: "Terminal strip", go: ask("shell") },
    ] },
  ],
  [
    { head: "Find", items: [
      { key: "p", label: "Quick open a file", go: () => run("mod.open", { name: "dendro-quick-open" }) },
      { key: "o", label: "Switch project", go: () => run("mod.open", { name: "dendro-switcher" }) },
    ] },
    { head: "History", items: [
      { key: "[", label: "Back", go: ask("back") },
      { key: "]", label: "Forward", go: ask("forward") },
    ] },
  ],
  [
    { head: "Window", items: [
      { key: "n", label: "New tab", go: () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }) },
      { key: "b", label: "Sidebar", go: () => run("layout.toggle", { id: "sidebar" }) },
      { key: ",", label: "Settings", go: () => run("app.settings", {}) },
      { key: "?", keys: ["?", "/"], label: "All keys", go: () => run("app.help", {}) },
    ] },
  ],
];
const ITEMS = COLUMNS.flat().flatMap((g) => g.items);

export default class Leader extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    // Opening can move the keyboard away at first (as in the other popups).
    cx.timer.after(150, () => this.handle.focus());
  }

  choose(it) {
    closeOverlay(props()?.overlay);
    it.go();
  }

  render() {
    const t = theme();
    const cap = (k) => div().w(22).h(22).flex_none().flex().items_center().justify_center().rounded(5)
      .border_1().border_color(t.border).bg(t.background).text_size(12).font_semibold().text_color(t.foreground).child(k);
    const row = (it) => h_flex().id(`leader-${it.key}`).h(28).px(6).gap(10).items_center().rounded(7).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(() => this.choose(it))
      .child(cap(it.key)).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(it.label));
    const group = (g, i) => v_flex().gap(1)
      .when(i > 0, (el) => el.mt(8))
      .child(div().px(6).pb(4).text_size(11).text_color(t.dim).child(g.head))
      .children(g.items.map(row));
    return v_flex().id("leader").track_focus(this.handle).w_full().min_h(0).p(12).gap(10).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        const m = e.modifiers ?? {};
        if (e.key === "escape") { cx.stop_propagation(); return closeOverlay(props()?.overlay); }
        if (m.control || m.alt || m.platform) return;
        const it = ITEMS.find((x) => (x.keys ?? [x.key]).includes(e.key) && (x.key !== "?" || m.shift || e.key === "?"));
        if (!it) return;
        cx.stop_propagation();
        this.choose(it);
      })
      .child(h_flex().gap(16).items_start()
        .children(COLUMNS.map((col) => v_flex().flex_1().min_w(0).children(col.map(group)))))
      .child(div().px(6).text_size(11).text_color(t.dim).child("Press a key · Esc closes"));
  }
}
