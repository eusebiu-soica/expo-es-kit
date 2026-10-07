---
name: history
description: "Build a visual history of an Expo app's expo-es-kit audits — a self-contained HTML dashboard (overall score over time, per-category trends, open P0/P1/P2 findings per audit, audit table, light/dark) from docs/audits/*.json, plus a score badge (badge.svg and a shields.io endpoint badge.json) for the app's README. Use when the user asks for audit history, score trend, progress over time, a dashboard of audits, or a README badge."
argument-hint: "[appPath] [--dir=docs/audits] [--out=<file.html>]"
---

# expo-es-kit · history

## Steps

1. Locate the plugin root:
   - `PLUGIN_ROOT` is two levels above this SKILL.md.
   - If that is unknown, run `find ~/.claude/plugins -type f -path '*expo-es-kit*/scripts/scan.mjs' | head -1` and strip `/scripts/scan.mjs`.
2. Run `node "$PLUGIN_ROOT/scripts/history.mjs" <appPath> [--dir=…] [--out=…]`.
   - It reads every expo-es-kit report JSON in the audits folder: `type: "audit"` for the trend, and `type: "fix"` reports are counted.
   - It writes these files:

     | File | Contents |
     |---|---|
     | `docs/audits/history.html` | Self-contained page with no CDN; works offline and when committed |
     | `docs/audits/badge.svg` | Static badge, e.g. `expo audit · 7.4/10`, colored by status |
     | `docs/audits/badge.json` | shields.io endpoint format |

   - If it reports that there are no audits, offer to run `/expo-es-kit:audit`.
3. Tell the user where the files are and how to open them:
   - Open `docs/audits/history.html` in a browser.
   - On macOS: `open docs/audits/history.html`. On Windows: `start docs\audits\history.html`. On WSL: `explorer.exe "$(wslpath -w docs/audits/history.html)"`.
4. Offer the README badge snippet. Pick the one that fits:
   - **Committed SVG**: works for private repos and needs no network:
     ```md
     [![Expo audit](docs/audits/badge.svg)](docs/audits/history.html)
     ```
   - **shields.io endpoint**: needs a public repo; replace `<owner>/<repo>/<branch>`:
     ```md
     ![Expo audit](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/<owner>/<repo>/<branch>/docs/audits/badge.json)
     ```
   - Add it to the README only if the user says yes. Put it next to any existing badges.
5. Summarize in 3–5 lines:
   - the latest score and verdict
   - the change since the previous audit
   - the best and worst moving categories
   - whether P0/P1 counts are trending down

## Notes

- The badge reflects the **latest audit**. Re-run this skill after every audit, or after `fix`, which writes a fix report.
- Commit `docs/audits/` so the history survives and the team sees the trend.
- Nothing is uploaded anywhere. Everything is generated locally from your JSON reports.
