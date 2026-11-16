#!/usr/bin/env python3
"""Claude Code status line: your plan limits under each chat.

Claude Code runs this after each response with session details on stdin. It prints
the 5-hour and weekly limits, and saves them where Herdr's status bar
(the dendro-status-bar mod) picks them up.

Turn it on in ~/.claude/settings.json:
  "statusLine": { "type": "command", "command": "~/.config/herdr-app/mods/dendro-status-bar/claude-statusline.py" }
"""
import json
import os
import sys
import time

SAVED = os.path.expanduser("~/.cache/herdr-dendro/claude-limits.json")
WINDOWS = (("five_hour", "5h"), ("seven_day", "week"))


def window(limits, key):
    w = limits.get(key)
    if not isinstance(w, dict) or not isinstance(w.get("used_percentage"), (int, float)):
        return None
    return {"used_percentage": w["used_percentage"], "resets_at": w.get("resets_at") or 0, "at": w.get("at") or int(time.time())}


def newer(new, was):
    """Several sessions write the file, and an idle one can hold older numbers. Usage only goes
    up within a window, so keep the later reset, then the higher percentage."""
    if new and was and (was["resets_at"], was["used_percentage"]) > (new["resets_at"], new["used_percentage"]):
        return was
    return new or was


def save(fresh, model):
    """The 5-hour limit is one number for the account. The weekly one is reported per session and
    can differ by model (some models have their own weekly limit), so it is kept per model, with
    when it was reported (`at`) so the status bar can tell an old reading from a different limit."""
    try:
        with open(SAVED) as f:
            old = json.load(f)
    except Exception:
        old = {}
    now = int(time.time())
    out = {"at": now, "weekly": {}}
    five = newer(fresh.get("five_hour"), window(old, "five_hour"))
    if five:
        out["five_hour"] = five
    weekly = old.get("weekly") if isinstance(old.get("weekly"), dict) else {}
    for name in set(weekly) | {model}:
        w = newer(fresh.get("seven_day") if name == model else None, window(weekly, name))
        if w and w["resets_at"] > now:  # a week that has rolled over says nothing about this one
            out["weekly"][name] = w
    os.makedirs(os.path.dirname(SAVED), exist_ok=True)
    tmp = f"{SAVED}.{os.getpid()}"
    with open(tmp, "w") as f:
        json.dump(out, f)
    os.replace(tmp, SAVED)


def main():
    try:
        data = json.load(sys.stdin)
        limits = data.get("rate_limits") or {}
        model = str((data.get("model") or {}).get("display_name") or "Claude")
    except Exception:
        return
    fresh = {key: window(limits, key) for key, _ in WINDOWS}
    if not any(fresh.values()):
        return  # an API key or gateway login: no plan limits to show
    try:
        save(fresh, model)
    except Exception:
        pass  # the line under the chat still works
    now, parts = time.time(), []
    for key, label in WINDOWS:
        w = fresh[key]
        if not w:
            continue
        used = round(w["used_percentage"])
        color = "\033[31m" if used >= 95 else "\033[33m" if used >= 80 else "\033[2m"
        text = f"{label} {used}%"
        if w["resets_at"] > now:
            at = time.localtime(w["resets_at"])
            text += " · resets " + time.strftime("%H:%M" if w["resets_at"] - now < 86400 else "%a %H:%M", at)
        parts.append(f"{color}{text}\033[0m")
    print("\033[2m  │  \033[0m".join(parts))


main()
