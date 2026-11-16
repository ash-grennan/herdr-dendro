// The shipped status bar, plus your Claude plan limits (5-hour and weekly).
// The numbers come from claude-statusline.py in this folder, which Claude Code runs
// after each response and which saves them to LIMITS; see that file for the one setting it needs.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, home, readTextFile } from "herdr";

const LIMITS = ".cache/herdr-dendro/claude-limits.json";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const two = (n) => String(n).padStart(2, "0");

export default class DendroStatusBar extends View {
  init(_props, cx) {
    this.limits = null;
    this.raw = null;
    this.load(cx);
    cx.timer.every(20000, (cx) => this.load(cx));
  }

  load(cx) {
    cx.spawn(async (cx) => {
      const raw = await readTextFile(`${home()}/${LIMITS}`).catch(() => null);
      if (raw === this.raw) return;
      this.raw = raw;
      try { this.limits = raw ? JSON.parse(raw) : null; } catch { this.limits = null; }
      cx.notify();
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  // One limit: label, a small bar, the percentage and (unless hidden) when it resets.
  limit(w, label, t, reset = true) {
    if (!w || typeof w.used_percentage !== "number") return null;
    const now = Date.now() / 1000, over = w.resets_at && w.resets_at <= now; // the window has rolled over since
    const used = over ? 0 : Math.max(0, Math.min(100, Math.round(w.used_percentage)));
    const color = used >= 95 ? t.blocked : used >= 80 ? t.ansi3 : t.muted;
    const at = reset && w.resets_at && !over ? new Date(w.resets_at * 1000) : null;
    const when = at && `${w.resets_at - now < 86400 ? "" : DAYS[at.getDay()] + " "}${two(at.getHours())}:${two(at.getMinutes())}`;
    return h_flex().gap(6).items_center().flex_none()
      .child(div().text_color(t.dim).child(label))
      .child(div().w(44).h(4).rounded(2).bg(t.border).overflow_hidden().child(div().h_full().w(Math.max(used ? 2 : 0, 44 * used / 100)).rounded(2).bg(color)))
      .child(div().text_color(color).child(`${used}%`))
      .when(Boolean(when), (el) => el.child(div().text_color(t.dim).child(`resets ${when}`)));
  }

  // The weekly limit is reported per session, kept per model: usually one limit seen at
  // different moments, sometimes a model's own. One figure unless they really differ.
  weekly(t) {
    const now = Date.now() / 1000;
    let rows = Object.entries(this.limits?.weekly ?? {}).filter(([, w]) => typeof w?.used_percentage === "number" && w.resets_at > now)
      .sort(([a], [b]) => a.localeCompare(b));
    if (!rows.length) return [];
    // A lower reading that is over an hour older than the newest is most likely just out of date.
    const newest = rows.reduce((a, b) => ((b[1].at ?? 0) > (a[1].at ?? 0) ? b : a))[1];
    rows = rows.filter(([, w]) => w === newest || (w.at ?? 0) > (newest.at ?? 0) - 3600 || w.used_percentage > newest.used_percentage);
    const top = rows.reduce((a, b) => (b[1].used_percentage > a[1].used_percentage ? b : a))[1];
    const close = rows.every(([, w]) => top.used_percentage - w.used_percentage <= 5 && w.resets_at === top.resets_at);
    if (close) return [this.limit(top, "week", t)];
    const oneReset = rows.every(([, w]) => w.resets_at === top.resets_at);
    return rows.map(([model, w], i) => this.limit(w, `week ${model.split(" ")[0]}`, t, !oneReset || i === rows.length - 1));
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const limits = [this.limit(this.limits?.five_hour, "5h", t), ...this.weekly(t)].filter(Boolean);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .when(limits.length > 0, el => el.child(h_flex().gap(14).items_center().flex_none().child(div().text_color(t.dim).child("Claude")).children(limits)))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
