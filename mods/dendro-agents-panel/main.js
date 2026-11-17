// Agents grouped into light, colour-coded boxes by folder (the agent's git repo, else its
// folder), plus Herdr's priority and by-space views. Based on Herdr's shipped `agents` mod.
// It stands in for the Spaces list too: spaces without an agent get a row at the bottom, the
// space you're in is marked, and right-click gives a space's menu (rename, worktrees, close).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, home, knownAgents, pickFolder, checking, nextCommand } from "herdr";
import { listKey } from "./listnav.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "folders", label: "Grouped by folder", icon: "folder" },
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const SORT_KEY = "dendro.agents.sort";
// Tab id -> the colour (a theme key) of its first agent's folder, for the tab bar's tab borders.
const TAB_COLORS = "dendro.agents.tabColors";
const sortOf = () => SORTS.find((s) => s.id === shared(SORT_KEY)) ?? SORTS[0];

// Folder colours: the same name-picked bright ANSI colours as the Files panel.
const PALETTE = ["ansi12", "ansi13", "ansi14", "ansi10", "ansi11", "ansi9", "ansi4", "ansi5", "ansi6", "ansi3"];
function folderColor(name, t) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return t[PALETTE[h % PALETTE.length]] ?? t.accent;
}
const alpha = (c, a) => /^#[0-9a-f]{6}$/i.test(c) ? c + a : c;
// How far apart two theme colours look (0 the same, ~765 black to white); null when not #rrggbb.
function apart(x, y) {
  const rgb = (c) => /^#[0-9a-f]{6}$/i.test(c ?? "") ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null;
  const a = rgb(x), b = rgb(y);
  if (!a || !b) return null;
  const mean = (a[0] + b[0]) / 2, d = a.map((v, i) => v - b[i]);
  return Math.sqrt((2 + mean / 256) * d[0] ** 2 + 4 * d[1] ** 2 + (2 + (255 - mean) / 256) * d[2] ** 2);
}
const TOO_CLOSE = 90;
const base = (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
// Where a space is now: its first terminal's live folder, else where it was made.
function place(sp, all) {
  const tabs = new Set((sp.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || sp.folder;
}
// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
// A linked worktree has a git dir of its own under the shared one; a submodule's are the same.
async function checkout(folder, on) {
  const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { cwd: folder, on });
  const [dir, common] = r.code === 0 ? r.stdout.trim().split("\n") : [];
  if (!dir || !common) return null;
  return dir === common ? "main" : "linked";
}
// Projects: folders added with the header's button (shared, so they're kept); each git repo
// directly inside one is listed under it, so you can open a space or start an agent there.
const ROOTS = "dendro.projects.roots", RESCAN = "dendro.projects.rescan";
const projectRoots = () => (Array.isArray(shared(ROOTS)) ? shared(ROOTS) : []).filter((r) => typeof r === "string");
// What the switcher popup lists (dendro-switcher), and how many sessions it shows per folder.
const SWITCH = "dendro.switcher", SWITCH_SESSIONS = 3;
const PROJECTS_SHOWN = 8;       // per folder, most recently committed first, until "more"
const within = (p, dir) => Boolean(p) && (p === dir || p.startsWith(dir + "/"));
// The repos in a folder (this machine): [{ path, name, at }], at: the last commit (seconds), 0 for none.
async function scanRoot(root) {
  const script = 'for d in "$1"/*/; do [ -e "$d.git" ] || continue; p=$(cd "$d" && pwd -P) || continue; '
    + 't=$(git -C "$p" log -1 --format=%ct 2>/dev/null); printf "%s\\t%s\\n" "${t:-0}" "$p"; done';
  const r = await exec("sh", ["-c", script, "projects", root]);
  const seen = new Set(), out = [];
  for (const line of r.stdout.split("\n")) {
    const tab = line.indexOf("\t"), path = line.slice(tab + 1);
    if (tab < 0 || !path || seen.has(path)) continue;   // a link to a repo also listed: once
    seen.add(path);
    out.push({ path, name: base(path), at: Number(line.slice(0, tab)) || 0 });
  }
  return out.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    if (props()?.menu) return this.initMenu(cx);
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    try { this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}") ?? {}; } catch { this.changed = {}; }
    try { this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]"); } catch { this.pendingPins = []; }
    if (!Array.isArray(this.pendingPins)) this.pendingPins = [];
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    this.roots = new Map();   // "machine\0cwd" -> repo root (or the cwd itself)
    // Spaces this panel named after their agent's folder: space id -> the name it gave.
    try { this.spaceNames = JSON.parse(localStorage.getItem("spaceNames") ?? "{}"); } catch { this.spaceNames = {}; }
    this.naming = {};         // space id -> { name, at }: the rename last asked for
    // Folder -> the colour it was given (a theme key), kept so a folder stays the colour you know.
    try { this.colors = JSON.parse(localStorage.getItem("folderColors") ?? "{}"); } catch { this.colors = {}; }
    this.asking = new Set();
    this.projects = new Map();     // root -> { list, at, error }: its repos, looked up every few minutes
    this.scanning = new Set();
    this.moreShown = new Set();    // roots showing all their projects, not the first few
    cx.timer.every(30000, (cx) => cx.notify());
    // The keyboard (Ctrl+Space A, or Alt+H into the sidebar): a cursor over the rows.
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.cursor = null;   // the id of the row the cursor is on
    this.nav = [];        // the rows on show, in order: { id, top (index in the list), open, menu?, fold?, unfold?, parent? }
    this.focusSeen = Date.now() - 2000; // a "dendro.focus" request just before this start still counts
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.takeFocus(cx);
      }
    });
  }

  takeFocus(cx) {
    this.handle.focus();
    cx.timer.after(150, () => this.handle.focus()); // a closing popup can take the keyboard back at first
    cx.notify();
  }

  // The list's keys (listnav.js). fold/unfold say whether they did anything: if not, ← / h goes
  // to the row's parent (its box or section) and → / l to the next row.
  onKey(e, cx) {
    const nav = this.nav, i = Math.max(0, nav.findIndex((n) => n.id === this.cursor)), n = nav[i];
    const move = (to) => { if (nav[to]) { this.cursor = nav[to].id; this.scroll.scroll_to_item(nav[to].top); } };
    const r = listKey(e, { at: i, count: nav.length, page: 10 });
    if (!r) return;
    cx.stop_propagation();
    if ("at" in r) move(r.at);
    else if (r.act === "leave") run("dendro-tab-bar.chat");
    else if (!n) return;
    else if (r.act === "open") n.open?.();
    else if (r.act === "menu") n.menu?.();
    else if (r.act === "unfold") { if (!n.unfold?.()) move(i + 1); }
    else if (r.act === "fold") { if (!n.fold?.() && n.parent) move(nav.findIndex((x) => x.id === n.parent)); }
    cx.notify();
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  // The folder an agent works in: its git repo's top, else its own folder. Looked up once per folder.
  folderOf(a, cwd, cx) {
    if (!cwd) return a.space_name || "?";
    const machine = a.address.includes("/") ? a.address.split("/")[0] : null, k = `${machine ?? ""}\0${cwd}`;
    if (this.roots.has(k)) return this.roots.get(k);
    if (!this.asking.has(k)) {
      this.asking.add(k);
      cx.spawn(async (cx) => {
        const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on: machine }).catch(() => null);
        this.roots.set(k, r?.code === 0 && r.stdout.trim() ? r.stdout.trim() : cwd);
        this.asking.delete(k);
        cx.notify();
      });
    }
    return cwd;
  }

  // Herdr calls an unnamed space after its first terminal's folder: here that is often the shell
  // above the chat, or wherever you happened to be when you made the space. Once a space has an
  // agent, call it after that agent's folder instead (the first agent's: space, tab, pane order).
  // A space you named yourself is left alone.
  nameSpaces(list, all, cx) {
    const all_spaces = spaces();
    if (!all_spaces.length) return;
    const cwdOf = new Map(panes().map((p) => [p.pane, p.cwd])), termCwd = new Map(all.map((x) => [x.address, x.cwd]));
    const now = Date.now();
    let changed = false;
    for (const sp of all_spaces) {
      const mine = this.spaceNames[sp.id];
      if (sp.named && sp.name !== mine) {   // you renamed it: yours now
        if (mine !== undefined) { delete this.spaceNames[sp.id]; changed = true; }
        continue;
      }
      const a = list.find((x) => x.space === sp.id);
      const cwd = a && (cwdOf.get(a.pane) || termCwd.get(a.address));
      if (!cwd) continue;
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      const root = this.roots.get(`${machine ?? ""}\0${cwd}`);
      if (root === undefined) { this.folderOf(a, cwd, cx); continue; }   // repo lookup under way; it redraws
      const name = !machine && root === home() ? "~" : base(root);
      if (!name || name === sp.name) continue;
      const asked = this.naming[sp.id];
      if (asked?.name === name && now - asked.at < 10000) continue;      // already asked; give it a moment
      this.naming[sp.id] = { name, at: now };
      this.spaceNames[sp.id] = name; changed = true;
      run("space.rename", { id: sp.id, name });
    }
    for (const id of Object.keys(this.spaceNames)) if (!all_spaces.some((sp) => sp.id === id)) { delete this.spaceNames[id]; changed = true; }
    if (changed) localStorage.setItem("spaceNames", JSON.stringify(this.spaceNames));
  }

  // A colour for each folder on show, no two alike while the palette lasts. A folder asks for the
  // colour its name picks (as the Files panel colours folders); if a folder on show already has that
  // colour, or one that looks much the same in this theme, it gets the one furthest from those taken.
  colorsFor(folders, t) {
    // taken: a set, and each pair of colours measured once, so a long Projects list stays cheap.
    const taken = new Set(), out = new Map(), far = new Map();
    const dist = (k, u) => {
      const id = `${k}|${u}`;
      if (!far.has(id)) far.set(id, apart(t[k], t[u]) ?? Infinity);
      return far.get(id);
    };
    const gap = (k) => { let g = Infinity; for (const u of taken) g = Math.min(g, u === k ? 0 : dist(k, u)); return g; };
    let changed = false;
    for (const f of folders) {            // first the folders that keep the colour they had
      const k = this.colors[f];
      if (!PALETTE.includes(k) || gap(k) < TOO_CLOSE) continue;
      taken.add(k); out.set(f, k);
    }
    for (const f of folders) {
      if (out.has(f)) continue;
      let h = 0;
      for (const ch of base(f).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      let k = PALETTE[h % PALETTE.length];
      if (gap(k) < TOO_CLOSE) k = PALETTE.reduce((best, c) => gap(c) > gap(best) ? c : best, k);
      taken.add(k); out.set(f, k);
      if (this.colors[f] !== k) { this.colors[f] = k; changed = true; }
    }
    if (changed) {
      const kept = Object.keys(this.colors);
      if (kept.length > 100) for (const f of kept) if (!out.has(f)) delete this.colors[f];
      localStorage.setItem("folderColors", JSON.stringify(this.colors));
    }
    return out;
  }

  // A projects folder's repos: what was found last, looked up again when over 5 minutes old.
  projectsFor(root, cx) {
    const got = this.projects.get(root);
    if ((!got || Date.now() - got.at > 300000) && !this.scanning.has(root) && !checking()) {
      this.scanning.add(root);
      cx.spawn(async (cx) => {
        try { this.projects.set(root, { list: await scanRoot(root), at: Date.now() }); }
        catch (e) { this.projects.set(root, { list: [], at: Date.now(), error: String(e?.message ?? e) }); }
        this.scanning.delete(root);
        cx.notify();
      });
    }
    return got;
  }

  // The header's button: pick a folder whose repos become projects.
  addRoot(cx) {
    cx.spawn(async (cx) => {
      const dir = await pickFolder({ prompt: "Add" }).catch(() => null);
      if (!dir) return;
      const root = dir.replace(/[\\/]+$/, "") || dir;
      if (!projectRoots().includes(root)) setShared(ROOTS, [...projectRoots(), root]);
      this.projects.delete(root);
      this.folded.delete(`proj-${root}`);
      cx.notify();
    });
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  rank(a) {
    return RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared(SORT_KEY, s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(s.icon === "folder" ? "mods/dendro-agents-panel/sort-folder.svg" : `mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  // Right-click: a popup (this mod again, with props.menu) for a space, and for an agent when one
  // was clicked: another session of the same agent, in the same folder, as a new tab in its space.
  openMenu(space, a, cwd, keyboard = false) {
    let agent = null;
    if (a) {
      const p = a.program ?? {};
      // Not one of the agents Herdr can start from a menu: the command that is running in its terminal.
      const typed = terminals().find((x) => x.address === a.address)?.foreground?.argv?.[0];
      agent = { folder: cwd ?? null, machine: a.address.includes("/") ? a.address.split("/")[0] : null, key: p.key ?? null, name: p.name || a.app || "agent", icon: p.icon ?? null, tint: Boolean(p.tint), typed: typed ? [typed] : null };
    }
    openOverlay({ mod: "dendro-agents-panel", kind: "popup", ...(keyboard ? {} : { at: "pointer" }), width: 250, height: 300, props: { menu: { space, agent } } });
  }

  // Right-click a project: open it, or start an agent in it (and rename or close the space open
  // there, which has no other row); a folder's header: rescan or remove it.
  openProjectMenu(project, root, keyboard = false) {
    const agentCount = (shared("new-menu.agents")?.[""] ?? []).filter((x) => x.installed !== false && x.run?.length).length || 2;
    const sp = project && spaces().find((s) => !s.machine && within(place(s, panes()), project.path));
    const height = 14 + 26 + 31 * (project ? 1 + agentCount + (sp ? 2 : 0) : 0) + (project ? 35 : 0) + 31 * 2;
    openOverlay({ mod: "dendro-agents-panel", kind: "popup", ...(keyboard ? {} : { at: "pointer" }), width: 260, height: Math.min(440, height), props: { menu: { project, root } } });
  }

  // Go to the space working in that folder, else make one there.
  openProject(path) {
    const sp = spaces().find((s) => !s.machine && within(place(s, panes()), path));
    if (sp) run("space.select", { id: sp.id });
    else run("space.new", { folder: path, machine: "" });
  }

  initMenu(cx) {
    const m = props().menu, a = m.agent;
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (m.project) {
      // The agents Herdr can start (its + menu's list), installed ones only.
      const usable = (list) => (list ?? []).filter((x) => x.installed !== false && x.run?.length);
      this.startable = usable(shared("new-menu.agents")?.[""]);
      cx.spawn(async (cx) => {
        const fresh = await knownAgents({ on: null }).catch(() => null);
        if (fresh) this.startable = usable(fresh);
        cx.notify();
      });
      return;
    }
    if (a) {
      // How to start that agent: Herdr's own command for it (the list its + menu uses), else what was typed.
      const known = (list) => list?.find((x) => x.key === a.key && x.run?.length);
      this.argv = known(shared("new-menu.agents")?.[a.machine ?? ""])?.run ?? a.typed;
      cx.spawn(async (cx) => {
        const found = known(await knownAgents({ on: a.machine }).catch(() => null));
        if (found) this.argv = found.run;
        this.checked = true;
        cx.notify();
      });
    }
    const sp = spaces().find((s) => s.id === m.space), folder = sp && place(sp, panes());
    if (folder) cx.spawn(async (cx) => {
      this.git = await checkout(folder, sp.machine).catch(() => null);
      cx.notify();
    });
  }

  // { label, icon | pic, go, off?, head? }: head puts a line and the space's name above the item.
  menuItems(t) {
    const m = props().menu, a = m.agent, out = [];
    const ic = (name) => `mods/workspace-chrome/${name}.svg`;
    const tree = (action) => () => openOverlay({ mod: "worktree", kind: "dialog", ...(action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: { space: m.space, action } });
    if (m.root) {
      const p = m.project;
      if (p) {
        const sp = spaces().find((s) => !s.machine && within(place(s, panes()), p.path));
        out.push({ head: p.name, label: sp ? "Go to its space" : "Open in a new space", icon: ic(sp ? "layers" : "folder"), go: () => this.openProject(p.path) });
        for (const ag of this.startable ?? []) out.push({ label: `New ${ag.name} session`, pic: icon(ag, 14, t.foreground), icon: ic("plus"), go: () => {
          const now = spaces().find((s) => !s.machine && within(place(s, panes()), p.path));
          if (now) { run("tab.new", { name: ag.name, space: now.id, folder: p.path, argv: ag.run }); run("space.select", { id: now.id }); }
          else run("space.new", { folder: p.path, argv: ag.run, machine: "" });
        } });
        if (sp) out.push({ label: "Rename space", icon: ic("square-pen"), go: () => run("space.rename", { id: sp.id }) },
          { label: "Close space", icon: ic("x"), go: () => run("space.close", { id: sp.id }) });
      }
      const h = home(), shown = h && within(m.root, h) ? "~" + m.root.slice(h.length) : m.root;
      out.push({ head: `Projects · ${shown}`, label: "Look for new repos", icon: ic("search"), go: () => setShared(RESCAN, Date.now()) });
      out.push({ label: "Remove from Projects", icon: ic("x"), go: () => setShared(ROOTS, projectRoots().filter((r) => r !== m.root)) });
      return out;
    }
    if (a) {
      const can = Boolean(this.argv?.length);
      out.push({ label: can || !this.checked ? `New ${a.name} session` : `Can't start ${a.name} from here`, pic: icon(a, 14, can ? t.foreground : t.dim), icon: ic("plus"), off: !can, go: () => {
        run("tab.new", { name: a.name, space: m.space, ...(a.folder ? { folder: a.folder } : {}), argv: this.argv });
        if (!spaces().find((s) => s.id === m.space)?.active) run("space.select", { id: m.space });
      } });
    }
    const sp = spaces().find((s) => s.id === m.space);
    if (!sp) return out;
    out.push({ head: `Space · ${sp.name}`, label: "Rename space", icon: ic("square-pen"), go: () => run("space.rename", { id: sp.id }) });
    if (this.git) out.push({ label: "New worktree", icon: ic("git-branch"), go: tree("new") }, { label: "Open worktree", icon: ic("git-branch"), go: tree("open") });
    if (this.git === "linked") out.push({ label: "Remove worktree", icon: ic("git-branch"), go: tree("remove") });
    out.push({ label: "Close space", icon: ic("x"), go: () => run("space.close", { id: sp.id }) });
    return out;
  }

  menu(t) {
    const list = this.menuItems(t);
    const choose = (i) => {
      const it = list[i];
      if (!it || it.off) return;
      closeOverlay(props().overlay);
      it.go();
    };
    return v_flex().id("agent-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down" || e.key === "j") this.at = (this.at + 1) % list.length;
        else if (e.key === "up" || e.key === "k") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") choose(this.at);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(list.map((it, i) => v_flex()
        .when(it.head !== undefined, (el) => el
          .when(i > 0, (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
          .child(div().px(8).pt(4).pb(5).text_size(11).text_color(t.dim).truncate().child(it.head)))
        .child(h_flex().id(`am-${i}`).h(31).px(8).gap(9).rounded(7).items_center()
          .text_color(it.off ? t.dim : t.foreground)
          .when(i === this.at && !it.off, (el) => el.bg(t.selected)).when(!it.off, (el) => el.hover((s) => s.bg(t.hover)))
          .on_click(() => choose(i))
          .child(it.pic ?? svg(it.icon).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().child(it.label)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.menu) return this.menu(t);
    const collapsed = narrow();
    const sort = sortOf();
    const ask = shared("dendro.focus");
    if (ask?.to === "agents" && ask.at > this.focusSeen) { this.focusSeen = ask.at; cx.timer.after(0, (cx) => this.takeFocus(cx)); }
    // Keyboard rows, by section (Projects are built before the rows above them), joined in order at the end.
    const keys = this.handle.is_focused();
    const navAll = { groups: [], empty: [], projects: [] };
    let group = null;  // the box or section being built: an agent row's parent
    const nav = (part, id, acts) => { navAll[part].push({ id, top: null, ...acts }); return keys && this.cursor === id; };
    const cursorBar = (el, on, bg = true) => el.when(on, (e) => e.relative().when(bg, (e) => e.bg(t.hover)).child(div().absolute().left(0).top(6).bottom(6).w(2).rounded(1).bg(t.accent)));
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const here = spaces().find((sp) => sp.active)?.id;   // the space you're in
    const now = Date.now();
    this.track(list, now);
    this.nameSpaces(list, all, cx);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const peopled = new Set(list.map((a) => a.space));
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority", byFolder = sort.id === "folders";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    // Each agent's folder (folders view): its pane's live folder, else its terminal's, else its space's.
    const cwdOf = new Map(panes().map((p) => [p.pane, p.cwd])), termCwd = new Map(all.map((x) => [x.address, x.cwd]));
    const spaceFolder = new Map(spaces().map((sp) => [sp.id, sp.folder]));
    const folderOf = new Map(list.map((a) => [a.address, this.folderOf(a, cwdOf.get(a.pane) || termCwd.get(a.address) || spaceFolder.get(a.space), cx)]));
    // Projects' repos (cached; looked up again now and then) share the colours: boxes pick first.
    const boxFolders = [...new Set(folderOf.values())].sort(), boxed = new Set(boxFolders);
    // Looked up on the narrow rail too, where they aren't drawn: the switcher lists them all the same.
    // Asked to look again: what was found stays on show until the new list is in.
    const rescan = shared(RESCAN);
    if (rescan !== this.rescan) { this.rescan = rescan; for (const got of this.projects.values()) got.at = 0; }
    const projectLists = projectRoots().map((root) => {
      const got = this.projectsFor(root, cx);
      return { root, got, all: (got?.list ?? []).filter((p) => !boxed.has(p.path)) };
    });
    const colorKey = this.colorsFor([...boxFolders, ...new Set(projectLists.flatMap((l) => l.all.map((p) => p.path)))], t);
    const tabColors = {};
    for (const a of list) tabColors[a.tab] ??= colorKey.get(folderOf.get(a.address));
    const sent = JSON.stringify(tabColors);
    if (sent !== this.sentColors) {
      this.sentColors = sent;
      cx.timer.after(0, () => setShared(TAB_COLORS, tabColors));   // not while rendering: it redraws every mod
    }
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    // Folders: alphabetical, so a folder stays where you last saw it; inside, the most urgent first.
    if (byFolder) list = [...list].sort((x, y) => base(folderOf.get(x.address)).localeCompare(base(folderOf.get(y.address))) || folderOf.get(x.address).localeCompare(folderOf.get(y.address)) || rankOf(y) - rankOf(x) || this.since(y) - this.since(x));
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    // For the switcher (dendro-switcher): each folder with its latest sessions, then the projects,
    // named and coloured as here. Shared only when it changes.
    const sessionName = (a) => detail.get(a.address) ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
    const inFolder = new Map();
    for (const a of list) {
      const f = folderOf.get(a.address);
      if (!inFolder.has(f)) inFolder.set(f, []);
      inFolder.get(f).push(a);
    }
    const switcher = {
      folders: [...inFolder].map(([path, as]) => {
        const latest = [...as].sort((x, y) => this.since(y) - this.since(x));
        return { path, name: base(path), color: colorKey.get(path) ?? null, count: as.length, at: this.since(latest[0]),
          sessions: latest.slice(0, SWITCH_SESSIONS).map((a) => ({ pane: a.pane, label: sessionName(a), status: a.status, at: this.since(a), focused: Boolean(a.focused), icon: a.program?.icon ?? null, tint: Boolean(a.program?.tint), space: a.space_name ?? "" })) };
      }),
      projects: projectLists.flatMap((l) => l.all).map((p) => ({ path: p.path, name: p.name, color: colorKey.get(p.path) ?? null, at: p.at * 1000 })),
    };
    const switchSent = JSON.stringify(switcher);
    if (switchSent !== this.switchSent) {
      this.switchSent = switchSent;
      cx.timer.after(0, () => setShared(SWITCH, switcher));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      const toggleKids = () => {
        if (!subs.length) return false;
        this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
        return true;
      };
      const cur = nav("groups", `ag-${a.address}`, {
        parent: group,
        open: () => run("pane.focus", { pane: a.pane }),
        menu: () => this.openMenu(a.space, a, cwdOf.get(a.pane) || termCwd.get(a.address), true),
        fold: () => subs.length > 0 && !this.folded.has(a.address) && toggleKids(),
        unfold: () => subs.length > 0 && this.folded.has(a.address) && toggleKids(),
      });
      if (collapsed) {
        return cursorBar(h_flex(), cur)
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return cursorBar(h_flex(), cur, !a.focused)
        .id(`ag-${a.address}`)
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(a.space, a, cwdOf.get(a.pane) || termCwd.get(a.address)); })
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        // In a folder's box, but its tab lives in a space called something else: say which.
        .when(byFolder && !isPinned && Boolean(a.space_name) && a.space_name !== base(folderOf.get(a.address) ?? ""), el => el.child(div().flex_none().max_w(70).truncate().text_size(10).text_color(t.dim).child(a.space_name)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const folder = folderOf.get(a.address);
      const id = byPriority ? `sec-${r}` : byFolder ? `dir-${folder}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : byFolder ? base(folder) : a.space_name || "", folder: byFolder ? folder : null, space: byPriority || byFolder ? null : a.space, status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      group = g.id;
      const cur = nav("groups", g.id, {
        open: () => { open ? this.folded.add(g.id) : this.folded.delete(g.id); },
        menu: g.space ? () => this.openMenu(g.space, null, null, true) : null,
        fold: () => open && Boolean(this.folded.add(g.id)),
        unfold: () => !open && this.folded.delete(g.id),
      });
      return cursorBar(h_flex(), cur, false)
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .when(Boolean(g.space), (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(g.space); }))
        .child(div().truncate().text_color(g.space && g.space === here ? t.foreground : (t[g.status] ?? t.dim)).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    // Folders: each group is a light box in its folder's colour, with the folder as its header.
    const h = home();
    const pretty = (p) => h && p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
    const box = (g) => {
      const open = !this.folded.has(g.id), color = t[colorKey.get(g.folder)] ?? folderColor(g.label, t);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      const parent = pretty(g.folder).replace(/[\\/][^\\/]*$/, "");
      // A box can hold agents of more than one space: its menu is for the one you're in, else its first agent's.
      const mine = g.members.some((a) => a.space === here), space = mine ? here : g.members[0].space;
      group = g.id;
      const cur = nav("groups", g.id, {
        open: () => { open ? this.folded.add(g.id) : this.folded.delete(g.id); },
        menu: () => this.openMenu(space, null, null, true),
        fold: () => open && Boolean(this.folded.add(g.id)),
        unfold: () => !open && this.folded.delete(g.id),
      });
      return v_flex().id(`box-${g.id}`).flex_none().mb(6).p(3).rounded(10)
        .bg(alpha(color, mine ? "1c" : "0f")).border_1().border_color(alpha(color, mine ? "99" : "38"))
        .child(cursorBar(h_flex(), cur, false).id(g.id).h(28).px(6).gap(7).flex_none().items_center().rounded(7).cursor_pointer()
          .hover((s) => s.bg(alpha(color, "1a"))).when(cur, (e) => e.bg(alpha(color, "1a")))
          .on_click((_e, cx) => { open ? this.folded.add(g.id) : this.folded.delete(g.id); cx.notify(); })
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(space); })
          .child(svg(`mods/dendro-agents-panel/folder${open ? "-open" : ""}.svg`).size(14).flex_none().text_color(color))
          .child(div().flex_none().max_w(140).truncate().text_size(12.5).font_semibold().text_color(color).child(g.label))
          .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(parent))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(String(g.members.length)))
          .when(!open && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true))))
        .when(open, (el) => el.children(g.members.flatMap(withKids)));
    };
    // Spaces with no agent (only shells, say) aren't in any group: a row each, so they can still be
    // reached, renamed and closed from here.
    const allPanes = panes(), allSpaces = spaces();
    const placeOf = new Map(allSpaces.map((sp) => [sp.id, place(sp, allPanes)]));   // once each, not per row
    const spaceRow = (sp) => {
      const folder = place(sp, allPanes) || "";
      const cur = nav("empty", `space-${sp.id}`, { open: () => run("space.select", { id: sp.id }), menu: () => this.openMenu(sp.id, null, null, true) });
      return cursorBar(h_flex(), cur, !sp.active).id(`space-${sp.id}`).h(30).px(9).gap(7).flex_none().rounded(8).items_center().cursor_pointer()
        .when(sp.active, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click(() => run("space.select", { id: sp.id }))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(sp.id); })
        .child(svg("mods/dendro-agents-panel/folder.svg").size(14).flex_none().text_color(sp.active ? folderColor(sp.name, t) : t.dim))
        .child(div().flex_none().max_w(150).truncate().text_color(sp.active ? t.foreground : t.muted).child(sp.name))
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(pretty(folder).replace(/[\\/][^\\/]*$/, "")))
        .when(Boolean(sp.machine), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(sp.machine)));
    };
    // On the narrow rail: a folder icon each, named in its tooltip.
    const railSpace = (sp) => cursorBar(h_flex(), nav("empty", `space-${sp.id}`, { open: () => run("space.select", { id: sp.id }), menu: () => this.openMenu(sp.id, null, null, true) }), !sp.active).id(`space-${sp.id}`).h(26).flex_none().items_center().justify_center()
      .when(sp.active, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: sp.id }))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(sp.id); })
      .tooltip(sp.name)
      .child(svg("mods/dendro-agents-panel/folder.svg").size(14).flex_none().text_color(sp.active ? folderColor(sp.name, t) : t.dim));
    // Projects: each added folder's repos that have no agent (those have a box above). A space
    // open in one is marked on its row and left out of "No agents", while that row is on show.
    const listed = [];
    const spaceIn = (path) => allSpaces.find((sp) => !sp.machine && within(placeOf.get(sp.id), path));
    const note = (text) => div().px(9).py(4).flex_none().text_size(11.5).text_color(t.dim).child(text);
    const projectRow = (p, root) => {
      const sp = spaceIn(p.path), color = t[colorKey.get(p.path)] ?? folderColor(p.name, t);
      const cur = nav("projects", `proj-${p.path}`, { parent: `proj-${root}`, open: () => this.openProject(p.path), menu: () => this.openProjectMenu({ path: p.path, name: p.name }, root, true) });
      return cursorBar(h_flex(), cur, !sp?.active).id(`proj-${p.path}`).h(28).px(9).gap(7).flex_none().rounded(8).items_center().cursor_pointer()
        .when(Boolean(sp?.active), (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click(() => this.openProject(p.path))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openProjectMenu({ path: p.path, name: p.name }, root); })
        .tooltip(sp ? `${pretty(p.path)} \u00b7 open in ${sp.name}` : pretty(p.path))
        .child(svg("mods/dendro-agents-panel/folder.svg").size(14).flex_none().text_color(sp ? color : alpha(color, "8c")))
        .child(div().flex_1().min_w(0).truncate().text_color(sp ? t.foreground : t.muted).child(p.name))
        .when(Boolean(sp), (el) => el.child(div().size(5).rounded(3).flex_none().bg(color)))
        .when(p.at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - p.at * 1000))));
    };
    const projectSections = (collapsed ? [] : projectLists).flatMap(({ root, got, all }) => {
      const key = `proj-${root}`, open = !this.folded.has(key), more = this.moreShown.has(root);
      const onShow = open ? (more ? all : all.slice(0, PROJECTS_SHOWN)) : [];
      listed.push(...onShow.map((p) => p.path));
      const head = () => cursorBar(h_flex(), nav("projects", key, {
        open: () => { open ? this.folded.add(key) : this.folded.delete(key); },
        menu: () => this.openProjectMenu(null, root, true),
        fold: () => open && Boolean(this.folded.add(key)),
        unfold: () => !open && this.folded.delete(key),
      }), false).id(key).px(8).pt(10).h(32).flex_none().gap(6).items_center().text_size(11).font_medium().text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { open ? this.folded.add(key) : this.folded.delete(key); cx.notify(); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openProjectMenu(null, root); })
        .child(div().flex_none().child("Projects"))
        .child(div().flex_1().min_w(0).truncate().child(`\u00b7 ${pretty(root)}`))
        .child(div().flex_none().child(got ? String(all.length) : "\u2026"))
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none());
      if (!open) return [head];
      const rows = onShow.map((p) => () => projectRow(p, root));
      if (got?.error) rows.push(() => note(got.error));
      else if (got && !all.length) rows.push(() => note(got.list.length ? "Each repo here has agents above" : "No git repos directly in this folder"));
      if (all.length > PROJECTS_SHOWN) rows.push(() => cursorBar(div(), nav("projects", `proj-more-${root}`, { parent: key, open: () => { more ? this.moreShown.delete(root) : this.moreShown.add(root); } })).id(`proj-more-${root}`).px(9).h(24).flex_none().flex().items_center().text_size(11.5).text_color(t.dim)
        .cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { more ? this.moreShown.delete(root) : this.moreShown.add(root); cx.notify(); })
        .child(more ? "Show fewer" : `${all.length - PROJECTS_SHOWN} more`));
      return [head, ...rows];
    });
    const empty = allSpaces.filter((sp) => !peopled.has(sp.id) && !(!sp.machine && listed.some((path) => within(placeOf.get(sp.id), path))));
    // Each row joins the list as it's made: keyboard rows made since the last one are inside it.
    const rows = [];
    const put = (part) => (el) => { rows.push(el); for (const n of navAll[part]) if (n.top === null) n.top = rows.length - 1; };
    if (collapsed) {
      list.forEach((a, i) => withKids(a, i).forEach(put("groups")));
      if (empty.length) { put("empty")(div().mx(8).my(5).h(1).flex_none().bg(t.border)); empty.forEach((sp) => put("empty")(railSpace(sp))); }
    } else {
      groups.forEach((g) => {
        if (byFolder && g.folder) return put("groups")(box(g));
        put("groups")(header(g));
        if (!this.folded.has(g.id)) g.members.forEach((a, i) => withKids(a, i).forEach(put("groups")));
      });
      if (empty.length) put("empty")(div().px(8).pt(10).pb(5).flex_none().text_size(11).font_medium().text_color(t.dim).child("No agents"));
      empty.forEach((sp) => put("empty")(spaceRow(sp)));
      projectSections.forEach((make) => put("projects")(make()));
    }
    this.nav = [...navAll.groups, ...navAll.empty, ...navAll.projects];
    // The cursor starts on the agent you're in, else the first row.
    if (!this.nav.some((n) => n.id === this.cursor)) {
      const mine = list.find((a) => a.focused);
      this.cursor = (this.nav.find((n) => mine && n.id === `ag-${mine.address}`) ?? this.nav[0])?.id ?? null;
    }

    return v_flex()
      .size_full()
      .min_h(0)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(h_flex().gap(12).items_center()
              .child(div().id("ag-switch").text_color(t.dim).hover((s) => s.text_color(t.foreground))
                .on_click(() => run("mod.open", { name: "dendro-switcher" }))
                .tooltip(`Go to a folder or session (${window()?.platform === "macos" ? "\u2318O" : "Alt+O"})`)
                .child(svg("mods/workspace-chrome/search.svg").size(14)))
              .child(div().id("ag-projects").text_color(t.dim).hover((s) => s.text_color(t.foreground))
                .on_click((_e, cx) => this.addRoot(cx))
                .tooltip("Add a folder of projects (the git repos in it)")
                .child(svg("mods/workspace-chrome/folder-plus.svg").size(14)))
              .child(div().id("ag-new").text_color(t.dim).hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))
                .tooltip("New terminal, agent or space")
                .child(svg("mods/workspace-chrome/plus.svg").size(14)))
              .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "dendro-agents-panel", kind: "popup", width: 210, height: 172, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(sort.icon === "folder" ? "mods/dendro-agents-panel/sort-folder.svg" : `mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            )),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).pb(6).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").track_scroll(this.scroll).children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
