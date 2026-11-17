// Right-click menu for the Files panel (dendro-files-panel). Opened as a popup at the
// pointer; each item hands a command back to the panel, which knows what was clicked.
// ↑/↓ or j/k move, Enter runs, Esc closes.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";

// [label, icon, command for the panel]. Adding one? Grow the popup's height in
// dendro-files-panel's openMenu (10 + 31 per item).
const ITEMS = [
  ["New File", "mods/dendro-files-menu/file-plus.svg", "dendro-files-panel.new-file"],
  ["New Folder", "mods/dendro-files-menu/folder-plus.svg", "dendro-files-panel.new-folder"],
];

export default class FilesMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const it = ITEMS[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    run(it[2]);
  }

  render() {
    const t = theme();
    return v_flex().id("files-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down" || e.key === "j") this.at = (this.at + 1) % ITEMS.length;
        else if (e.key === "up" || e.key === "k") this.at = (this.at + ITEMS.length - 1) % ITEMS.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        cx.notify();
      })
      .children(ITEMS.map((it, i) => h_flex().id(`fm-${i}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
        .when(i === this.at, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
        .on_click(() => this.choose(i))
        .child(svg(it[1]).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(it[0]))));
  }
}
