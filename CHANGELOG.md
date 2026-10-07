# Changelog

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
