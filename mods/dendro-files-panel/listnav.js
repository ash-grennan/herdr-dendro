// Keys for a list that holds the keyboard (the Agents, Files and Changes panels), the same in each:
// ↑↓ or j/k move, Home/End or g/G go to the ends, Page Up/Down move a page, → or l unfold,
// ← or h fold, Enter opens, Shift+F10 or m opens the row's menu, Esc leaves.
// Returns { at } (a row to move to), { act } (what to do with row `at`), or null (not a list key).
export function listKey(e, { at, count, page = 10 }) {
  const m = e.modifiers ?? {};
  if (m.control || m.alt || m.platform) return null;
  const k = e.key, shift = Boolean(m.shift);
  const last = Math.max(0, count - 1), here = Math.min(Math.max(at ?? 0, 0), last);
  if (k === "escape") return { act: "leave" };
  if (!count) return null;
  if ((k === "f10" && shift) || (k === "m" && !shift)) return { act: "menu" };
  if (shift) return k === "g" || k === "G" ? { at: last } : null;
  switch (k) {
    case "down": case "j": return { at: Math.min(last, here + 1) };
    case "up": case "k": return { at: Math.max(0, here - 1) };
    case "home": case "g": return { at: 0 };
    case "end": case "G": return { at: last };
    case "pagedown": return { at: Math.min(last, here + page) };
    case "pageup": return { at: Math.max(0, here - page) };
    case "right": case "l": return { act: "unfold" };
    case "left": case "h": return { act: "fold" };
    case "enter": return { act: "open" };
    default: return null;
  }
}
