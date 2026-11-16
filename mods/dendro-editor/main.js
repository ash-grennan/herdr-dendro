// A small editor for the main area: files opened from the Files panel, as tabs, with
// save (Ctrl+S), a modified dot, and reload when the file changes on disk (an agent's edit).
// Built on Herdr's own Editor (syntax highlighting, line numbers, folding).
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { shared, setShared, readTextFile, writeTextFile, theme, settings, run, home } from "herdr";
import { fileIcon } from "./icons.js";

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
const OPEN = "dendro.open", DIRTY = "dendro.editor.dirty";
const showCenter = (child) => run("layout.select", { stack: "center", child });

export default class DendroEditor extends View {
  init(_props, cx) {
    this.docs = [];          // { path, on, name, saved, state, dirty, error, conflict, discard }
    this.active = null;
    this.seen = undefined;   // the last open request handled
    this.handle = cx.focus_handle();
    if (shared(DIRTY)) setShared(DIRTY, 0); // left over from a run that ended with unsaved edits
    cx.timer.every(2000, (cx) => this.poll(cx));
  }

  // Layout switched or app quitting: nothing is open any more.
  async close() { setShared(DIRTY, 0); }

  doc(path = this.active) { return this.docs.find((d) => d.path === path) ?? null; }

  open(request, cx) {
    let d = this.doc(request.path);
    if (!d) {
      d = { path: request.path, on: request.on ?? null, name: request.path.split(/[\\/]/).pop(), state: null, dirty: false, preview: isMarkdown(request.path) };
      this.docs.push(d);
      this.load(d, cx);
    }
    this.active = d.path; // called while rendering: no cx.notify() here (load() redraws when the text arrives)
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
    const n = this.docs.filter((d) => d.dirty).length;
    if ((shared(DIRTY) ?? 0) !== n) setShared(DIRTY, n);
  }

  // Follow the file on disk while it's open: reload it when untouched, flag it when edited here too.
  poll(cx) {
    const d = this.doc();
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
    const i = this.docs.indexOf(d);
    this.docs.splice(i, 1);
    if (this.active === path) this.active = this.docs[Math.min(i, this.docs.length - 1)]?.path ?? null;
    if (!this.docs.length) { setShared(OPEN, null); showCenter("main"); }
    this.publishDirty();
    cx.notify();
  }

  render(cx) {
    const request = shared(OPEN);
    if (request?.at && request.at !== this.seen) { this.seen = request.at; this.open(request, cx); }
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
        .child(image(fileIcon(doc.name)).size(14).flex_none())
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
      })
      .child(h_flex().id("dendro-editor-tabs").h(40).flex_none().px(6).gap(4).items_center().bg(t.chrome).border_b(1).border_color(t.border).overflow_x_scrollbar()
        .children(this.docs.map(tab)))
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
          .child(TextView.markdown(`dendro-md-text-${d.path}`, d.state.value()).selectable(true))
        : d?.state ? Editor.new(d.state).flex_1().min_h(0)
        : div().flex_1().flex().items_center().justify_center().text_color(t.dim)
          .child(d ? (d.error ?? "Opening…") : "Click a file in Files to open it here"));
  }
}
