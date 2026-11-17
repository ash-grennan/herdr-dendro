// A small editor for the main area: files opened from the Files panel, as tabs, with
// save (Ctrl+S), a modified dot, and reload when the file changes on disk (an agent's edit).
// Built on Herdr's own Editor (syntax highlighting, line numbers, folding).
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { shared, setShared, readTextFile, writeTextFile, theme, settings, run, home, spaces, window, nextCommand, exec, appHome } from "herdr";
import { fileIcon } from "./icons.js";
// A file's icon: its glyph, tinted by its type.
const fileGlyph = (name, t, size) => { const f = fileIcon(name); return svg(f.path).size(size).flex_none().text_color(t[f.color] ?? t.muted); };

// The Editor's language names, where they differ from the file extension.
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html", htm: "html", yml: "yaml" };
const languageOf = (path) => {
  const name = path.split(/[\\/]/).pop().toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : name;
  return Object.prototype.hasOwnProperty.call(LANG, ext) ? LANG[ext] : ext;
};
// Markdown opens rendered (Preview), with Edit beside it; prose wraps instead of scrolling sideways.
const isMarkdown = (path) => /\.(md|markdown|mdx)$/i.test(path);
const isProse = (path) => isMarkdown(path) || /\.(txt|text|rst|adoc)$/i.test(path);
// Pictures in a Markdown preview. TextView draws none, so the preview is split at every line that is
// only a picture (Markdown or <img>), and each is drawn with image(). That reads only from Herdr's
// own folder, so each local picture gets a link (a copy on Windows) under data/dendro-editor/img/,
// named with the file's modified time: Herdr keeps an image by its name, so a changed picture gets
// a new link (and its old one goes). Pictures on the web or on another machine show as a link.
const MD_IMG = /^\s*\[?\s*!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+["'][^"']*["'])?\s*\)(?:\s*\]\([^)]*\))?\s*$/;
const HTML_IMG = /^\s*(?:<(?:p|a)\b[^>]*>\s*)*<img\b([^>]*)>\s*(?:<\/(?:p|a)>\s*)*$/i;
const attr = (attrs, name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];
function markdownParts(text) {
  const parts = [], buf = [];
  let fence = null;
  const flush = () => { if (buf.length) parts.push({ text: buf.splice(0).join("\n") }); };
  for (const line of text.split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) fence = !fence ? f[1] : f[1].startsWith(fence) ? null : fence;
    const md = !fence && !f && MD_IMG.exec(line), html = !fence && !f && !md && HTML_IMG.exec(line);
    const src = md ? md[2] ?? md[3] : html && attr(html[1], "src");
    if (src) { flush(); parts.push({ src, alt: (md ? md[1] : attr(html[1], "alt")) ?? "" }); }
    else buf.push(line);
  }
  flush();
  return parts;
}
// A PowerShell string: single quotes, curly ones too, doubled.
const quote = (s) => "'" + s.replace(/['‘’‚‛]/g, "$&$&") + "'";
const hash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16); };
// A picture's path from the Markdown file it's in; null for a URL.
function picturePath(doc, src) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) return null;
  let p = src.split(/[?#]/)[0];
  try { p = decodeURI(p); } catch {}
  if (!/^([\\/]|[a-z]:)/i.test(p)) p = doc.path.replace(/[^\\/]*$/, "") + p;
  const out = [];
  for (const part of p.split(/[\\/]/)) part === ".." ? out.length > 1 && out.pop() : part !== "." && out.push(part);
  return out.join(doc.path.includes("\\") && !doc.path.includes("/") ? "\\" : "/");
}
const OPEN = "dendro.open", DIRTY = "dendro.editor.dirty";
// Open files belong to the space they were opened in: each space has its own tabs.
const spaceNow = () => spaces().find((s) => s.active)?.id ?? "";
const showCenter = (child) => run("layout.select", { stack: "center", child });

export default class DendroEditor extends View {
  init(_props, cx) {
    this.docs = [];          // { space, path, on, name, saved, state, dirty, error, conflict, discard }
    this.activeBy = {};      // space id -> the path its editor shows
    this.seen = undefined;   // the last open request handled
    this.handle = cx.focus_handle();
    this.pictures = new Map(); // a picture's path -> its name in Herdr's folder, null while linking, false if missing
    this.pictureTimes = new Map(); // a picture's path -> its modified time when linked, "-" if missing
    if (shared(DIRTY)) setShared(DIRTY, null); // left over from a run that ended with unsaved edits
    cx.timer.every(2000, (cx) => this.poll(cx));
    // The keyboard: given by Ctrl+Space E, Enter on a file in Files, or Alt+H/J/K/L onto the editor.
    this.focusSeen = Date.now() - 2000; // a "dendro.focus" request just before this start still counts
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.takeFocus(cx);
      }
    });
  }

  // Into the text when there is some to edit, else the editor itself (Esc then goes back to the chat).
  // Again a little later: the file may still be loading, or a closing popup may take the keyboard back.
  takeFocus(cx) {
    const give = () => { const d = this.doc(); if (d?.state && !d.preview) d.state.focus(); else this.handle.focus(); };
    give();
    cx.timer.after(150, give);
    cx.timer.after(400, give);
    cx.notify();
  }

  // Layout switched or app quitting: nothing is open any more.
  async close() { setShared(DIRTY, null); }

  get active() { return this.activeBy[spaceNow()] ?? null; }
  set active(path) { this.activeBy[spaceNow()] = path; }

  // The shown space's files, and one of them (default: the one on screen).
  shown() { const space = spaceNow(); return this.docs.filter((d) => d.space === space); }
  doc(path = this.active) { return this.shown().find((d) => d.path === path) ?? null; }

  open(request, cx) {
    const space = request.space;
    let d = this.docs.find((x) => x.space === space && x.path === request.path);
    if (!d) {
      d = { space, path: request.path, on: request.on ?? null, name: request.path.split(/[\\/]/).pop(), state: null, dirty: false, preview: isMarkdown(request.path) };
      this.docs.push(d);
      this.load(d, cx);
    }
    this.activeBy[space] = d.path; // called while rendering: no cx.notify() here (load() redraws when the text arrives)
  }

  load(d, cx) {
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(d.path, { on: d.on });
        if (text === null) { if (d.state) d.gone = true; else d.error = "This file no longer exists"; }
        else if (text.includes("\0")) d.error = "Binary file · can't edit";
        else this.setText(d, text);
      } catch { d.error = "Can't open this file (over 1 MiB, or unreadable)"; }
      cx.notify();
    });
  }

  setText(d, text) {
    d.saved = text; d.dirty = false; d.error = null; d.conflict = false; d.gone = false; d.note = null;
    if (d.state) { d.state.set_value(text); return; }
    const t = theme();
    d.state = EditorState.new({
      language: languageOf(d.path), value: text, readonly: Boolean(d.on), soft_wrap: isProse(d.path),
      font_family: settings().font_family, font_size: 13,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6 },
    });
    d.state.on("change", (_e, cx) => {
      const dirty = d.state.value() !== d.saved;
      if (dirty !== d.dirty) { d.dirty = dirty; d.discard = false; this.publishDirty(); cx.notify(); }
    });
  }

  publishDirty() {
    // Unsaved files per space, for the dot on that space's Editor switch.
    const by = {};
    for (const d of this.docs) if (d.dirty) by[d.space] = (by[d.space] ?? 0) + 1;
    if (JSON.stringify(shared(DIRTY) ?? {}) !== JSON.stringify(by)) setShared(DIRTY, by);
  }

  // Follow the file on disk while it's open: reload it when untouched, flag it when edited here too.
  poll(cx) {
    const d = this.doc();
    if (d?.preview && !d.on) this.checkPictures(cx);
    if (!d?.state || d.busy) return;
    cx.spawn(async (cx) => {
      const text = await readTextFile(d.path, { on: d.on }).catch(() => undefined);
      if (text === undefined) return;
      const before = `${d.gone}${d.conflict}${d.saved === text}`;
      if (text === null) d.gone = true;
      else {
        d.gone = false;
        if (text !== d.saved) { if (d.dirty) d.conflict = true; else this.setText(d, text); }
      }
      // Redraw only when something changed: every redraw repaints the whole window.
      if (before === `${d.gone}${d.conflict}${d.saved === text}`) return;
      cx.notify();
    });
  }

  save(cx, overwrite = false) {
    const d = this.doc();
    if (!d?.state || d.on || (!d.dirty && !overwrite && !d.gone) || d.busy) return;
    const text = d.state.value();
    d.busy = true;
    cx.spawn(async (cx) => {
      try {
        const expected = overwrite || d.gone ? await readTextFile(d.path) : d.saved;
        await writeTextFile(d.path, text, expected ?? null);
        d.saved = text; d.dirty = d.state.value() !== text; d.conflict = false; d.gone = false; d.note = null;
      } catch (e) {
        // A changed file gets the reload / keep-mine choice; anything else (read-only, too big) just says why.
        const now = await readTextFile(d.path).catch(() => undefined);
        if (now === null) d.gone = true;
        else if (now !== undefined && now !== d.saved) { d.conflict = true; d.note = "Not saved: the file changed on disk"; }
        else d.note = `Not saved: ${e?.message ?? e}`;
      } finally { d.busy = false; this.publishDirty(); cx.notify(); }
    });
    cx.notify();
  }

  // Drop what's typed here and show the file as it is on disk.
  reload(cx) {
    const d = this.doc();
    if (!d) return;
    d.dirty = false; d.conflict = false; d.note = null;
    this.publishDirty();
    this.load(d, cx);
    cx.notify();
  }

  closeDoc(path, cx) {
    const d = this.doc(path);
    if (!d) return;
    if (d.dirty && !d.discard) { d.discard = true; this.active = path; cx.notify(); return; }
    d.state?.release();
    const i = this.shown().indexOf(d);
    this.docs.splice(this.docs.indexOf(d), 1);
    const left = this.shown();
    if (this.active === path) this.active = left[Math.min(i, left.length - 1)]?.path ?? null;
    // Forget the request that opened it, or a reload of this mod would open it again.
    const request = shared(OPEN);
    if (request?.path === path && request.space === d.space) setShared(OPEN, null);
    if (!left.length) showCenter("main");
    this.publishDirty();
    cx.notify();
  }

  // The Markdown preview: text, and the pictures that stand on their own line.
  preview(d, t, cx) {
    return markdownParts(d.state.value()).map((part, i) => {
      if (part.text !== undefined) return TextView.markdown(`dendro-md-text-${d.path}-${i}`, part.text).selectable(true);
      const path = d.on ? null : picturePath(d, part.src), name = path ? this.picture(path, cx) : undefined;
      if (name) return div().py(6).child(image(name).max_w_full());
      const label = part.alt || part.src.split(/[\\/]/).pop();
      return TextView.markdown(`dendro-md-img-${d.path}-${i}`, name === false ? `*Picture not found: ${part.src}*` : name === null ? "" : `[Picture: ${label}](${part.src})`);
    });
  }

  // A picture's name in Herdr's folder, linking it there on first use.
  picture(path, cx) {
    if (this.pictures.has(path)) return this.pictures.get(path);
    this.pictures.set(path, null);
    const ext = (/\.[a-z0-9]{1,5}$/i.exec(path)?.[0] ?? ".png").toLowerCase(), id = hash(path), dir = appHome() + "/data/dendro-editor/img";
    cx.spawn(async (cx) => {
      let time = null;
      try {
        const r = window()?.platform === "windows"
          ? await exec("powershell", ["-NoProfile", "-Command", "& { param($f, $d, $h, $x) if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { exit 1 }; $m = (Get-Item -LiteralPath $f).LastWriteTimeUtc.Ticks; New-Item -ItemType Directory -Force -Path $d | Out-Null; Remove-Item -Path \"$d/$h-*\" -ErrorAction SilentlyContinue; Copy-Item -LiteralPath $f -Destination \"$d/$h-$m$x\" -Force; $m } " + [path, dir, id, ext].map(quote).join(" ")])
          : await exec("sh", ["-c", '[ -f "$1" ] || exit 1; m=$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1") || exit 1; mkdir -p "$2" && rm -f "$2/$3"-* && ln -s "$1" "$2/$3-$m$4" && echo "$m"', "picture", path, dir, id, ext]);
        if (r.code === 0) time = r.stdout.trim();
      } catch {}
      this.pictures.set(path, time ? `data/dendro-editor/img/${id}-${time}${ext}` : false);
      this.pictureTimes.set(path, time ?? "-");
      cx.notify();
    });
    return null;
  }

  // While a preview shows (on the editor's 2s poll): a picture changed on disk, gone, or back
  // again is forgotten, so the next draw links it afresh.
  checkPictures(cx) {
    const paths = [...this.pictures.keys()].filter((p) => this.pictures.get(p) !== null);
    if (!paths.length || this.checking) return;
    this.checking = true;
    cx.spawn(async (cx) => {
      try {
        const r = window()?.platform === "windows"
          ? await exec("powershell", ["-NoProfile", "-Command", "& { foreach ($f in $args) { if (Test-Path -LiteralPath $f -PathType Leaf) { (Get-Item -LiteralPath $f).LastWriteTimeUtc.Ticks } else { '-' } } } " + paths.map(quote).join(" ")])
          : await exec("sh", ["-c", 'for f; do stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo -; done', "pictures", ...paths]);
        const times = r.stdout.split(/\r?\n/);
        const stale = paths.filter((p, i) => (times[i] ?? "").trim() !== this.pictureTimes.get(p));
        for (const p of stale) { this.pictures.delete(p); this.pictureTimes.delete(p); }
        if (stale.length) cx.notify();
      } catch {}
      this.checking = false;
    });
  }

  render(cx) {
    const request = shared(OPEN);
    if (request?.at && request.at !== this.seen) { this.seen = request.at; if (request.space) this.open(request, cx); }
    const ask = shared("dendro.focus");
    if (ask?.to === "editor" && ask.at > this.focusSeen) { this.focusSeen = ask.at; cx.timer.after(0, (cx) => this.takeFocus(cx)); }
    const t = theme(), d = this.doc(), h = home();
    const pretty = (p) => h && p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
    const stop = (_e, cx) => cx.stop_propagation();

    const tab = (doc) => {
      const on = doc.path === this.active;
      return h_flex().id(`doc-${doc.path}`).h(30).pl(10).pr(6).gap(6).flex_none().items_center().rounded(7).cursor_pointer()
        .bg(on ? t.background : t.chrome).border_1().border_color(on ? t.border : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(on ? t.background : t.hover))
        .on_click((_e, cx) => { this.active = doc.path; cx.notify(); })
        .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); this.closeDoc(doc.path, cx); })
        .child(fileGlyph(doc.name, t, 14))
        .child(div().max_w(180).truncate().text_size(12.5).child(doc.name))
        .child(div().id(`close-${doc.path}`).size(18).flex_none().flex().items_center().justify_center().rounded(4)
          .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.closeDoc(doc.path, cx); })
          .child(doc.dirty ? div().size(7).rounded(4).bg(doc.discard ? t.blocked : t.foreground) : svg("mods/dendro-editor/x.svg").size(12).text_color(t.dim)));
    };

    const mode = (doc, preview, label) => {
      const on = Boolean(doc.preview) === preview;
      return div().id(`dendro-mode-${label}`).h(20).px(8).flex().items_center().rounded(4).text_size(11.5)
        .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted).when(!on, (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground)))
        .on_click((_e, cx) => { doc.preview = preview; cx.notify(); }).child(label);
    };

    const button = (id, label, enabled, action, strong = false) => div().id(id).h(22).px(9).flex().items_center().rounded(5).text_size(11.5)
      .bg(enabled && strong ? t.solid : t.raised).text_color(enabled ? (strong ? t.solid_foreground : t.foreground) : t.dim)
      .when(enabled, (e) => e.cursor_pointer().on_click(action)).child(label);

    return v_flex().id("dendro-editor").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        const mod = e.modifiers.control || e.modifiers.platform;
        if (mod && e.key === "s") { cx.stop_propagation(); this.save(cx); }
        else if (mod && e.key === "w" && this.active) { cx.stop_propagation(); this.closeDoc(this.active, cx); }
        // Esc only reaches here outside the text (a Markdown preview, no file): back to the chat.
        else if (e.key === "escape" && !(d?.state && !d.preview)) { cx.stop_propagation(); run("dendro-tab-bar.chat"); }
      })
      .child(h_flex().id("dendro-editor-tabs").h(40).flex_none().px(6).gap(4).items_center().bg(t.chrome).border_b(1).border_color(t.border).overflow_x_scrollbar()
        .children(this.shown().map(tab)))
      .when(Boolean(d), (el) => el.child(h_flex().h(30).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(pretty(d.path)))
        .when(Boolean(d.on), (e) => e.child(div().text_color(t.muted).child(`read-only · ${d.on}`)))
        .when(d.discard, (e) => e.child(div().text_color(t.blocked).child("Unsaved changes · × again to discard")))
        .when(isMarkdown(d.path) && Boolean(d.state), (e) => e.child(h_flex().flex_none().p(1).gap(1).rounded(6).bg(t.chrome).border_1().border_color(t.border)
          .child(mode(d, true, "Preview")).child(mode(d, false, "Edit"))))
        .child(div().text_color(t.dim).child(languageOf(d.path)))
        .when(!d.on, (e) => e.child(button("dendro-save", d.busy ? "Saving…" : "Save", (d.dirty || d.gone) && !d.busy, (_e, cx) => this.save(cx), true)))))
      .when(Boolean(d && (d.conflict || d.gone || d.note)), (el) => el.child(h_flex().flex_none().px(12).py(6).gap(8).items_center().bg(/^#[0-9a-f]{6}$/i.test(t.blocked) ? t.blocked + "22" : t.raised).text_size(12)
        .child(div().flex_1().min_w(0).child(d.gone ? "This file was deleted on disk · Save puts it back" : d.note ?? "Changed on disk while you were editing"))
        .when(d.conflict && !d.gone, (e) => e
          .child(button("dendro-reload", "Reload (discard mine)", true, (_e, cx) => this.reload(cx)))
          .child(button("dendro-overwrite", "Keep mine & save", true, (_e, cx) => this.save(cx, true), true)))))
      .child(d?.state && d.preview
        ? div().id(`dendro-md-${d.path}`).flex_1().min_h(0).min_w(0).overflow_y_scrollbar().px(28).py(18).text_size(14)
          .child(v_flex().gap(12).children(this.preview(d, t, cx)))
        : d?.state ? Editor.new(d.state).flex_1().min_h(0)
        : div().flex_1().flex().items_center().justify_center().text_color(t.dim)
          .child(d ? (d.error ?? "Opening…") : `Click a file in Files, or press ${window()?.platform === "macos" ? "⌘P" : "Alt+P"} to find one`));
  }
}
