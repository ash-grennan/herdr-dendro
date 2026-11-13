import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, terminals, run, openOverlay, theme, window, shared, layout, settings } from "herdr";
// The Terminal button's shell: one per tab, pinned above the chat, hidden (parked) rather than closed.
const SHELL_SHARE = 0.1; // of the tab's height

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    try { this.shells = JSON.parse(localStorage.getItem("shells") ?? "{}"); } catch { this.shells = {}; }
    try { this.autoDone = new Set(JSON.parse(localStorage.getItem("autoShell") ?? "[]")); } catch { this.autoDone = new Set(); }
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
          if (find(layout(), "center")?.active === "editor") run("layout.select", { stack: "center", child: "main" });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    // Changes and Files sit one above the other in the "panel" column; each button
    // shows or hides its own block, and the column hides when both are off.
    const panel = find(root, "panel");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    const isOn = id => Boolean(panel && !panel.hidden && !find(root, id)?.hidden);
    // This tab's shell: remembered by address once it has shown up in a pane of the tab.
    const tabId = shown[active]?.id, tabPanes = panes().filter(p => p.tab === tabId);
    const live = new Set(terminals().filter(x => x.state !== "finished").map(x => x.address));
    // Opening or bringing back the shell: run() returns nothing, so watch for its pane to appear,
    // then pin it above the chat at SHELL_SHARE of the height.
    const placing = this.placing && this.placing.tab === tabId && Date.now() < this.placing.until ? this.placing : null;
    if (placing) {
      const pane = tabPanes.find(p => p.terminal && (placing.terminal ? p.terminal === placing.terminal : !placing.before.has(p.terminal)));
      if (pane) {
        this.placing = null;
        if (!placing.terminal) { this.shells[tabId] = pane.terminal; localStorage.setItem("shells", JSON.stringify(this.shells)); }
        const chat = tabPanes.find(p => p.pane === placing.chat);
        if (chat) {
          if (tabPanes.indexOf(pane) > tabPanes.indexOf(chat)) run("pane.swap", { pane: pane.pane, target: chat.pane });
          run("layout.resize", { id: pane.pane, weight: 2 * SHELL_SHARE });
          run("layout.resize", { id: chat.pane, weight: 2 * (1 - SHELL_SHARE) });
          if (placing.refocus) run("pane.focus", { pane: chat.pane });
        }
      }
    }
    const shell = tabId && live.has(this.shells[tabId]) ? this.shells[tabId] : null;
    const shellShown = Boolean(shell && tabPanes.some(p => p.terminal === shell));
    const showShell = (refocus) => {
      // Split from the tab's first pane (the chat), not whichever pane has focus.
      const chat = tabPanes.find(p => p.terminal && p.terminal !== shell);
      if (!chat) return;
      run("pane.focus", { pane: chat.pane });
      this.placing = { tab: tabId, chat: chat.pane, terminal: shell, before: new Set(tabPanes.map(p => p.terminal).filter(Boolean)), refocus, until: Date.now() + 5000 };
      if (shell) run("terminal.keep", { terminal: shell, place: "down" });
      else run("terminal.open", { place: "down", ...(chat.cwd ? { folder: chat.cwd } : {}) });
    };
    const toggleShell = () => {
      if (find(layout(), "center")?.active === "editor") run("layout.select", { stack: "center", child: "main" });
      if (shellShown) run("terminal.park", { terminal: shell });
      else showShell(false);
    };
    // Open by default: a tab with only its chat gets the shell once; hidden or closed later, it stays that way.
    if (tabId && !this.placing && !shell && !this.autoDone.has(tabId) && tabPanes.length === 1 && tabPanes[0].terminal) {
      this.autoDone.add(tabId);
      localStorage.setItem("autoShell", JSON.stringify([...this.autoDone].slice(-500)));
      showShell(true);
    }
    const shellButton = h_flex().id("panel-terminal").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(shellShown ? t.selected : t.chrome).text_color(shellShown ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_click(toggleShell)
      .child(svg("mods/dendro-tab-bar/terminal.svg").size(14)).child("Terminal");
    const panelButton = (id, label, icon) => {
      const on = isOn(id);
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          const other = id === "files" ? "changes" : "files";
          if (on) {
            run("layout.hide", { id });
            if (!isOn(other)) run("layout.hide", { id: "panel" });
          } else {
            if (panel?.hidden) run("layout.hide", { id: other });
            run("layout.show", { id });
            run("layout.show", { id: "panel" });
          }
        }).child(svg(icon).size(14)).child(label);
    };
    // Chat | Editor: which view the main area shows (the "center" stack).
    const center = find(root, "center"), view = center?.active ?? "main", dirty = Number(shared("dendro.editor.dirty") ?? 0);
    const segment = (child, label) => {
      const on = view === child;
      return h_flex().id(`view-${child}`).h(24).px(10).gap(6).items_center().rounded(5).text_size(12)
        .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted).when(!on, e => e.cursor_pointer().hover(s => s.text_color(t.foreground)))
        .on_mouse_down("left", stop).on_click(() => run("layout.select", { stack: "center", child }))
        .child(label)
        .when(child === "editor" && dirty > 0, e => e.child(div().size(6).rounded(3).bg(t.blocked)));
    };
    const toggle = center && h_flex().flex_none().p(2).gap(2).mr(8).rounded(7).bg(t.chrome).border_1().border_color(t.border)
      .child(segment("main", "Chat")).child(segment("editor", "Editor"));
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .when(Boolean(toggle), el => el.child(toggle))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(Boolean(tabId), el => el.child(shellButton))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/dendro-tab-bar/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/dendro-tab-bar/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/dendro-tab-bar/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
