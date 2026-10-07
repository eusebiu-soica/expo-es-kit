# Changelog

## 0.2.0 — 2026-10-07
### Added
- `privacy`: App Store App Privacy + Google Play Data safety answers from evidence (SDK catalog of 35+ SDKs, permissions, code, DB schema), privacy manifest / required-reason API check, rejection-risk findings. New `scripts/privacy-scan.mjs`.
- `upgrade`: Expo SDK upgrades one verified major at a time (plan from release notes, patches, library compatibility, OTA safety, gates + device smoke test per step, re-audit). Uses the official Expo upgrade skill when installed.
- `history`: self-contained HTML dashboard of audit scores over time + `badge.svg` / shields.io `badge.json`. New `scripts/history.mjs`.
- Audit now suggests `history`, `upgrade` and `privacy` when relevant.
- `.gitattributes` forcing LF line endings.
- Project website (`docs/`, GitHub Pages): landing page with light/dark mode and a social preview image.

### Fixed
- Skill and agent frontmatter values are now quoted. Unquoted `: ` in some descriptions (setup skill, 6 agents) made YAML parsing fail, so their descriptions were silently dropped.
- `validate-plugin.mjs` now catches CRLF line endings and unsafe unquoted YAML values.

## 0.1.0 — 2026-10-07
First release.
- `audit`: scored 0–10 audit across 13 categories (+ HeroUI Native when installed), quick and deep (8 specialist agents + adversarial verifier) modes, GO / NO-GO verdict, trend vs previous report, Markdown + JSON reports in `docs/audits/`.
- `fix`: applies findings by priority, then mandatory final verification (gates, per-finding verifier, regression scan, re-audit of touched categories, before/after table).
- `setup`: per-folder CLAUDE.md generation, backend-mode aware (direct-db / api / hybrid), stale-claim detection, safe merge markers.
- `backend`: design / audit / implement for Supabase direct-DB and APIs on Next.js (Vercel), Supabase Edge Functions, Expo API Routes; auth & sessions end to end.
- `foundation`: production core modules (encrypted MMKV, SecureStore session adapter, API/Supabase clients, query cache, sign-out wipe, env validation, error boundary…).
- `heroui`: HeroUI Native audit (performance, tokens, animations, accessibility) and setup.
- Guard hook: warn-only PostToolUse checks for dangerous patterns in Expo projects.
- `scripts/scan.mjs`: zero-dependency static scanner used by all skills.
