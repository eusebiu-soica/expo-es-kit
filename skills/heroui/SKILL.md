---
name: heroui
description: "Audit and set up HeroUI Native (heroui-native) in an Expo app: performance (granular imports, single sheet host, skeleton cost, overdraw), design tokens (colors, typography, spacing, radius, dark/light parity), animations (Reanimated v4, reduced motion, sheets) and accessibility. 0–10 scores with suggestions. Use when the user mentions HeroUI / heroui-native, design tokens, or UI performance in a HeroUI Native app."
argument-hint: "[audit|setup] [appPath] [--out=<report.md>]"
---

# expo-es-kit · heroui

Only applies when `heroui-native` is in `package.json`. If it isn't installed, say so and stop. Suggest `/expo-es-kit:audit` for everything else.

## 0. Setup

- `PLUGIN_ROOT` is two levels above this SKILL.md. If unknown, run `find ~/.claude/plugins ~/.codex ~/.cursor/plugins ~/.agents -type f -path '*expo-es-kit*/scripts/scan.mjs' | head -1` and strip `/scripts/scan.mjs`.
- Read `PLUGIN_ROOT/shared/contract.md` (category `heroui`, IDs `HUI-xx`) and `references/checklist.md`.
- Run `node "$PLUGIN_ROOT/scripts/scan.mjs" <app> --summary > "$TMP/scan.json"`.
- HeroUI Native is young (v1.x). Where an API detail matters, check the installed version in `node_modules/heroui-native/package.json` and the official docs (https://heroui.com/docs/native). Don't rely on memory.

## audit

The audit has four sub-areas: **Performance**, **Tokens**, **Animations**, **Accessibility**. A fifth row, **Consistency**, covers raw `Pressable` versus HeroUI primitives, the styling policy, and duplicated custom components that re-implement a HeroUI one.

1. Read `references/performance.md`, `tokens.md`, `animations.md` and `accessibility.md`.
2. Start from the HeroUI hits listed in `checklist.md`. Then read:
   - the provider setup
   - the theme/token source (`global.css`, Uniwind/Tailwind theme, token constants)
   - the sheet strategy
   - 5–10 representative screens (the largest ones, and the ones with the most sheets)
3. Compute **token adoption** as `tokens.md` defines it, and report the percentage.
4. Write findings in the Finding JSON shape. For larger apps, delegate to `expo-es-kit:heroui-auditor` and verify the P0/P1 findings with `expo-es-kit:finding-verifier`.
5. Output:
   - **Sub-area table:** `| Area | Score /10 | Status | Key finding | Top suggestion |`. The **HeroUI overall** is the mean of the five rows.
   - **Top fixes table:** `| # | ID | Sev | Fix | Effort | File |`.
   - **Per-area details:** strengths, findings with `file:line`, and the fix.
6. Save the report to `docs/audits/heroui-audit-YYYY-MM-DD.{md,json}` (the JSON follows the contract, with `type: "heroui-audit"`). The main `/expo-es-kit:audit` includes the HeroUI overall as its `heroui` row.

## setup

1. **Agent rules for the UI folder.**
   - Use `templates/components-ui-claude.md` for `components/ui/CLAUDE.md`. If `components/ui/` doesn't exist, add it as a section in `components/CLAUDE.md`.
   - Fill in the placeholders with the real token file, sheet host and styling approach.
   - Merge into existing files using the `<!-- expo-es-kit:start/end -->` markers. Never overwrite.
2. **Import rule.** Use `templates/heroui-imports-rule.md` for `.claude/rules/heroui-imports.md`. Skip it if an equivalent rule already exists, in `.claude/rules` or in `.cursor/rules`.
3. **Optional code.** Offer these, and ask before adding them:
   - `templates/sheet-host.tsx`: a single sheet host with a registry. Offer it when the audit found more than 2 sheets mounted per screen.
   - `templates/skeleton-bypass.tsx`: renders the HeroUI Skeleton only while loading.

   Adapt both to the installed HeroUI API version.
4. Show a plan table and the diffs, then ask for confirmation. Then write, and run the typecheck if any code changed (ask first).

## Rules

- **Measured project decisions win over generic advice.** Examples: "FlashList removed after a regression", or "alpha kept over images". Read the project's docs and rules before flagging these.
- **Don't recommend swapping libraries or doing a big-bang token migration.** Prefer incremental, file-by-file fixes, ordered by the screens with the most traffic.
