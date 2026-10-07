---
name: backend
description: "Design, audit or implement the backend side of an Expo / React Native app securely, in either mode — direct database access from the app (Supabase + RLS, RPCs, storage policies) or an API hosted elsewhere (Next.js route handlers on Vercel, Supabase Edge Functions, Expo API Routes on EAS Hosting) — including auth and session correctness end to end (token storage, refresh, PKCE, server-side JWT verification, IDOR/BOLA, rate limits, sign-out). Use when the user asks about app↔backend architecture, API security, RLS, \"is my API secure\", auth/sessions, or wants to build an API endpoint for the app."
argument-hint: "[design|audit|implement] [appPath] [--api=<apiRepoPath>] [--framework=nextjs|supabase-edge|expo-api-routes]"
---

# expo-es-kit · backend

Three sub-commands. If none is given, infer one from the request: a question about the architecture → `design`, "check" or "secure?" → `audit`, "build" or "add an endpoint" → `implement`.

## 0. Setup

- `PLUGIN_ROOT` is two levels above this SKILL.md. If unknown, run `find ~/.claude/plugins -type f -path '*expo-es-kit*/scripts/scan.mjs' | head -1` and strip `/scripts/scan.mjs`.
- References live in `PLUGIN_ROOT/skills/backend/references/`:

| File | Use |
|---|---|
| `modes.md` | Choosing a mode, and the app-side rules for each mode |
| `direct-db-supabase.md` | RLS, policies, RPCs, storage, migrations |
| `api-nextjs-vercel.md`, `api-supabase-edge.md`, `api-expo-routes.md` | One per API framework |
| `auth-sessions.md` | The full session lifecycle on the client and the server |
| `api-security-checklist.md` | OWASP API Top 10 mapped to mobile backends, plus the launch gate |

- Run `node "$PLUGIN_ROOT/scripts/scan.mjs" <app> [--api=<api>] --summary > "$TMP/scan.json"`. Use `backend`, `appMigrations`, `api` and the auth-related hits.
- If the backend mode is api or hybrid, `--api` is missing, and a sibling repo looks like the API, ask whether to include it.

## design

1. Read `modes.md`. Ask only what you can't infer:
   - Does the app hold secrets or call third-party APIs?
   - Does it take payments or webhooks?
   - Are there multi-step business invariants?
   - Is there an admin or web client?
   - What is the expected scale?
   - Is the team comfortable writing RLS?
2. Recommend **one** mode (direct-db, api or hybrid) and, for API mode, one framework. Give the 3–5 decisive reasons.
3. Output a short architecture note:
   - the trust boundaries (what the client may do directly, and what must go through the server)
   - the auth flow (sign-in, then token, refresh, server verification, sign-out)
   - the endpoint/RPC conventions
   - the folder layout for both repos
   - the first 5 implementation steps
4. Offer to write it to `docs/architecture/backend.md` in the app. Also offer to run `/expo-es-kit:setup --mode=<mode>` so the agent rules match the decision.

## audit

This is a focused, deeper version of the audit's `backend` and `auth-sessions` categories.

- Follow `PLUGIN_ROOT/skills/audit/SKILL.md` with `--only=backend,auth-sessions,client-security,secure-storage` in **deep** mode. The specialists are `backend-auditor`, `auth-session-auditor`, `client-security-auditor` and `storage-cache-auditor`, followed by `finding-verifier`.
- Also walk the whole `api-security-checklist.md`. For each item, give one of these results:
  - ✅ with the file that proves it
  - ❌ with a finding
  - ⚪ n/a
- **Active probing.** This is optional, and you must ask first. Only do it against a local or preview environment the user names, never production, and only with test accounts the user provides. The probes are:
  - BOLA: user A's token on user B's resource id
  - no token at all
  - an expired token
  - an oversized body
  - a rate-limit burst

  Use `curl` and report the status codes.
- Save the report like the audit does, under the file name `backend-audit-YYYY-MM-DD.{md,json}`. Print the same summary table, limited to these categories, plus the checklist results.

## implement

1. Detect the framework, or take `--framework`:
   - `next` in the API package with an `app/api` folder → `nextjs`
   - a `supabase/functions` folder → `supabase-edge`
   - `+api.ts` files → `expo-api-routes`
2. Read the matching reference, plus `auth-sessions.md`.
3. **Reuse before you create.** If the repo already has an auth guard, a handler wrapper, an error type, a rate limiter or a validation helper, use them, and only extend them when needed. Otherwise, propose adding the shared pieces once, from the reference templates:
   - the handler wrapper (request id, error mapping, no stack leaks)
   - `requireAuth` (verifies the JWT server-side)
   - the zod validation helper
   - the rate limiter
   - the idempotency helper
4. For each endpoint the user wants:
   - Use a versioned path (`/api/v1/...`).
   - Validate every input with zod.
   - Derive the user id from the verified token, never from the body.
   - Check per-resource authorization.
   - Use a user-scoped DB client so RLS still applies. Use service role only when it is unavoidable, and only after the authorization check.
   - Return a generic error shape.
   - Add an idempotency key on mutations.
   - Rate-limit sensitive routes.
   - Add a typed response, and update the OpenAPI spec or the shared schema if the project uses one.
5. **App side.** Add or extend the single API client method, a TanStack Query hook with a query-key family, and invalidation of that family on mutation. Never put a token in a URL.
6. **DB.** Add a new migration with RLS and policies for any new table, following `direct-db-supabase.md`. Never edit applied migrations, and never apply migrations remotely.
7. **Tests.** Where the project has a test setup, add tests for:
   - no token → 401
   - another user's resource → 403 or 404
   - an invalid body → 400
   - the happy path
8. Finish with typecheck and lint in both repos (ask before running). Then show a short summary with the security properties of the new endpoint, written as a checklist.

## Rules

- Secrets only ever live in server env (Vercel env, `supabase secrets`, EAS Hosting env). Never in `EXPO_PUBLIC_*`, `NEXT_PUBLIC_*` or the app bundle.
- Never weaken RLS, auth or CORS to make something work. Find the right policy or endpoint instead.
- Never print secret values or tokens.
