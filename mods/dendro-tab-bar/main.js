import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, terminals, run, openOverlay, theme, window, shared, setShared, layout, settings, nextCommand } from "herdr";
// The Terminal button's shell: one per tab, pinned above the chat, hidden (parked) rather than closed.
const SHELL_SHARE = 0.1; // of the tab's height
// ...but never so little that the shell has under 3 rows: zsh then draws its prompt in a one-line
// mode that shows ? for the glyphs in it (➜, ✗, any theme's icons), in any terminal. SHELL_ROWS is
// what it gets instead; CHROME_ROWS is roughly a pane's header and padding, counted in rows.
const SHELL_ROWS = 4, CHROME_ROWS = 3;
function shellShare(shellRows, chatRows) {
  if (!(shellRows >= 0 && chatRows > 0)) return SHELL_SHARE;
  return Math.min(0.5, Math.max(SHELL_SHARE, (SHELL_ROWS + CHROME_ROWS) / (shellRows + chatRows + 2 * CHROME_ROWS)));
}
function sizeShell(shell, chat, share) {
  run("layout.resize", { id: shell.pane, weight: 2 * share });
  run("layout.resize", { id: chat.pane, weight: 2 * (1 - share) });
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// A tab nobody named is called after its agent's session, as the Agents panel calls it, cut to
// TAB_CHARS so tabs stay narrow (the whole title is the tooltip). A name you gave a tab is kept whole.
const TAB_CHARS = 12;
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
function sessionTitle(c, lead) {
  const prog = lead?.program?.name, live = clean(lead?.title);
  if (c.named && c.name !== prog) return null;
  // Not a title that only repeats the program, a folder, or user@host.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  return live && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead?.program?.key ? live : null;
}
const short = (s) => { const chars = [...s]; return chars.length > TAB_CHARS ? chars.slice(0, TAB_CHARS - 1).join("").trimEnd() + "…" : s; };

// An agent's tab is bordered in the colour of its folder's box in the Agents panel, which picks
// the colours and says which each tab gets (tab id -> a theme key).
const alpha = (c, a) => /^#[0-9a-f]{6}$/i.test(c) ? c + a : c;

// Back and forward (Alt+Left / Alt+Right): the places you've been, a place being a space, its tab
// and the main area's view (Chat or Editor). Changes closer together than SETTLE_MS (a jump that
// picks a space, then a tab, then Chat) make one step. TRAIL_MAX places are kept.
const SETTLE_MS = 500, TRAIL_MAX = 50;
const samePlace = (a, b) => Boolean(a && b) && a.space === b.space && a.tab === b.tab && a.view === b.view;
const placeLives = (p) => spaces().some(s => s.id === p.space && (!p.tab || (s.tabs ?? []).some(x => x.id === p.tab)));
function placeNow() {
  const space = spaces().find(p => p.active);
  if (!space) return null;
  return { space: space.id, tab: (space.tabs ?? []).find(x => x.active)?.id ?? null, view: find(layout(), "center")?.active ?? "main" };
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.grown = {};   // tab id -> { at, rows, chat }: when its shell was last given its rows back, and from what
    // A window made shorter doesn't redraw this bar by itself. Only while a shell is on show:
    // every redraw of a mod redraws the whole window.
    cx.timer.every(3000, (cx) => { if (this.shellUp) cx.notify(); });
    this.scroll = ScrollHandle.new();
    try { this.shells = JSON.parse(localStorage.getItem("shells") ?? "{}"); } catch { this.shells = {}; }
    try { this.autoDone = new Set(JSON.parse(localStorage.getItem("autoShell") ?? "[]")); } catch { this.autoDone = new Set(); }
    this.tabsSeen = new Set(); // every tab id at the last render, to notice one closing
    this.trail = [];       // places, oldest first
    this.at = -1;          // where in the trail you are
    this.going = null;     // { to, until }: a back/forward still taking effect
    this.noted = 0;        // when the last place was added (0: reached by back/forward)
    cx.spawn(async (cx) => {
      for (;;) {
        this.act(await nextCommand());
        cx.notify();
      }
    });
  }

  // What keys, the leader (dendro-leader) and the panels ask for: run("dendro-tab-bar.<command>").
  // Showing a panel or the editor asks it to take the keyboard ("dendro.focus").
  act(c) {
    const ctl = this.ctl;
    const focus = (to) => setShared("dendro.focus", { to, at: Date.now() });
    if (c === "back") this.go(-1);
    else if (c === "forward") this.go(1);
    else if (c === "files" || c === "changes") { ctl?.showPanel(c); focus(c); }
    else if (c === "agents") {
      if (find(layout(), "sidebar")?.hidden) run("layout.show", { id: "sidebar" });
      focus("agents");
    }
    else if (c === "view") {
      const editor = (find(layout(), "center")?.active ?? "main") === "editor";
      run("layout.select", { stack: "center", child: editor ? "main" : "editor" });
      if (editor) this.toChat(); else focus("editor");
    }
    else if (c === "shell") ctl?.toggleShell();
    else if (c === "chat") {
      if (find(layout(), "center")?.active === "editor") run("layout.select", { stack: "center", child: "main" });
      this.toChat();
    }
  }

  // The keyboard back to the shown tab's chat: its agent's pane, else its focused or first terminal.
  toChat() {
    const tab = spaces().find(s => s.active)?.tabs?.find(x => x.active)?.id;
    const mine = panes().filter(p => p.tab === tab && p.terminal);
    const to = mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
    if (to) run("pane.focus", { pane: to.pane });
  }

  // Called on every render: a place you've moved to joins the trail, dropping any forward places.
  notePlace() {
    const here = placeNow();
    if (!here) return;
    if (this.going) {
      if (samePlace(here, this.going.to)) { this.going = null; return; }
      if (Date.now() < this.going.until) return;
      this.going = null;
    }
    if (samePlace(here, this.trail[this.at])) return;
    const now = Date.now();
    this.trail = this.trail.slice(0, this.at + 1);
    if (this.noted && now - this.noted < SETTLE_MS && this.trail.length > 1) this.trail[this.trail.length - 1] = here;
    else this.trail.push(here);
    if (this.trail.length > TRAIL_MAX) this.trail.shift();
    this.at = this.trail.length - 1;
    this.noted = now;
  }

  // Back (-1) or forward (1), skipping places whose space or tab has closed.
  go(dir) {
    const kept = [];
    let at = -1;
    this.trail.forEach((p, i) => {
      if (placeLives(p) && !samePlace(p, kept[kept.length - 1])) kept.push(p);
      if (i <= this.at) at = kept.length - 1;
    });
    this.trail = kept;
    const i = at + dir, to = kept[i];
    this.at = at;
    if (!to) return;
    this.at = i;
    this.noted = 0;
    this.going = { to, until: Date.now() + 1500 };
    if (spaces().find(p => p.active)?.id !== to.space) run("space.select", { id: to.space });
    if (to.tab) run("tab.select", { id: to.tab });
    if ((find(layout(), "center")?.active ?? "main") !== to.view) run("layout.select", { stack: "center", child: to.view });
  }

  render() {
    this.notePlace();
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
    const leader = "Ctrl+Space"; // the leader key (keys.json), shown in the buttons' tooltips
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const tabColors = shared("dendro.agents.tabColors") ?? {};
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      const session = lead?.program?.agent ? sessionTitle(c, lead) : null;
      const tint = lead?.program?.agent && /^ansi\d+$/.test(tabColors[c.id] ?? "") ? t[tabColors[c.id]] ?? null : null;
      const name = session ? short(session) : /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(1).border_color(tint ? alpha(tint, c.active ? "e6" : "66") : c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
          if (find(layout(), "center")?.active === "editor") run("layout.select", { stack: "center", child: "main" });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(session) && name !== session, el => el.tooltip(session))
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
    const allTerminals = terminals();
    const live = new Set(allTerminals.filter(x => x.state !== "finished").map(x => x.address));
    const rowsOf = (address) => allTerminals.find(x => x.address === address)?.rows;
    // Opening or bringing back the shell: run() returns nothing, so watch for its pane to appear,
    // then pin it above the chat at SHELL_SHARE of the height.
    // Followed in the tab it was asked for (not just the shown one), and dropped when it times out.
    if (this.placing && Date.now() >= this.placing.until) this.placing = null;
    const placing = this.placing;
    if (placing) {
      const tabPanes = panes().filter(p => p.tab === placing.tab);
      const pane = tabPanes.find(p => p.terminal && (placing.terminal ? p.terminal === placing.terminal : !placing.before.has(p.terminal)));
      if (pane) {
        this.placing = null;
        if (!placing.terminal) { this.shells[placing.tab] = pane.terminal; localStorage.setItem("shells", JSON.stringify(this.shells)); }
        const chat = tabPanes.find(p => p.pane === placing.chat);
        if (chat) {
          if (tabPanes.indexOf(pane) > tabPanes.indexOf(chat)) run("pane.swap", { pane: pane.pane, target: chat.pane });
          if (tabPanes.length === 2) sizeShell(pane, chat, shellShare(rowsOf(pane.terminal), rowsOf(chat.terminal)));
          if (placing.refocus) run("pane.focus", { pane: chat.pane });
        }
      }
    }
    // A tab that closed since the last render takes its shell with it: a hidden (parked) one
    // would otherwise keep running with nothing on screen to show it.
    const tabsNow = new Set(spaces().flatMap(p => p.tabs ?? []).map(tab => tab.id));
    if (tabsNow.size) {
      let pruned = false;
      for (const id of this.tabsSeen) {
        if (tabsNow.has(id) || !(id in this.shells)) continue;
        const gone = this.shells[id];
        if (live.has(gone) && !panes().some(p => p.terminal === gone)) run("terminal.kill", { terminal: gone });
        delete this.shells[id]; pruned = true;
      }
      // Once a run: tabs that went while Herdr wasn't running, whose shells have gone too.
      if (!this.prunedStale) {
        this.prunedStale = true;
        for (const id of Object.keys(this.shells)) if (!tabsNow.has(id) && !live.has(this.shells[id])) { delete this.shells[id]; pruned = true; }
      }
      if (pruned) localStorage.setItem("shells", JSON.stringify(this.shells));
      this.tabsSeen = tabsNow;
    }
    const shell = tabId && live.has(this.shells[tabId]) ? this.shells[tabId] : null;
    const shellShown = Boolean(shell && tabPanes.some(p => p.terminal === shell));
    this.shellUp = shellShown;
    // Squeezed under 3 rows since (a shorter window, a dragged divider): it gets its rows back.
    if (shellShown && !this.placing && tabPanes.length === 2) {
      const pane = tabPanes.find(p => p.terminal === shell), chat = tabPanes.find(p => p.terminal !== shell);
      const rows = rowsOf(shell), chatRows = rowsOf(chat?.terminal), last = this.grown[tabId];
      if (rows >= 3) delete this.grown[tabId];
      // Not again while nothing has moved since the last try: a window too short for 3 rows even at half.
      else if (chat?.terminal && rows < 3 && !(last && last.rows === rows && last.chat === chatRows) && Date.now() - (last?.at ?? 0) > 3000) {
        this.grown[tabId] = { at: Date.now(), rows, chat: chatRows };
        sizeShell(pane, chat, shellShare(rows, chatRows));
      }
    }
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
    // Open by default: a tab with only an agent's chat gets the shell once; hidden or closed later, it stays that way.
    // (A plain Terminal tab is already a shell.)
    if (tabId && !this.placing && !shell && !this.autoDone.has(tabId) && tabPanes.length === 1 && tabPanes[0].terminal && tabPanes[0].program?.agent) {
      this.autoDone.add(tabId);
      localStorage.setItem("autoShell", JSON.stringify([...this.autoDone].slice(-500)));
      showShell(true);
    }
    const shellButton = h_flex().id("panel-terminal").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(shellShown ? t.selected : t.chrome).text_color(shellShown ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_click(toggleShell).tooltip(`Terminal (${leader} T)`)
      .child(svg("mods/dendro-tab-bar/terminal.svg").size(14)).child("Terminal");
    // Shows Files or Changes; with the column hidden, only that one.
    const showPanel = (id) => {
      if (isOn(id)) return;
      if (panel?.hidden) run("layout.hide", { id: id === "files" ? "changes" : "files" });
      run("layout.show", { id });
      run("layout.show", { id: "panel" });
    };
    this.ctl = { toggleShell: tabId ? toggleShell : () => {}, showPanel };
    const panelButton = (id, label, icon) => {
      const on = isOn(id);
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).tooltip(`${label} (${leader} ${id === "files" ? "F" : "G"})`)
        .on_click(() => {
          const other = id === "files" ? "changes" : "files";
          if (on) {
            run("layout.hide", { id });
            if (!isOn(other)) run("layout.hide", { id: "panel" });
          } else showPanel(id);
        }).child(svg(icon).size(14)).child(label);
    };
    // Chat | Editor: which view the main area shows (the "center" stack).
    const center = find(root, "center"), view = center?.active ?? "main", dirtyBy = shared("dendro.editor.dirty"), dirty = Number((dirtyBy && typeof dirtyBy === "object" ? dirtyBy[space?.id] : 0) ?? 0);
    const segment = (child, label) => {
      const on = view === child;
      return h_flex().id(`view-${child}`).h(24).px(10).gap(6).items_center().rounded(5).text_size(12)
        .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted).when(!on, e => e.cursor_pointer().hover(s => s.text_color(t.foreground)))
        .on_mouse_down("left", stop).on_click(() => run("layout.select", { stack: "center", child }))
        .when(!on, e => e.tooltip(`${label} (${leader} E)`))
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
