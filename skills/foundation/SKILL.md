---
name: foundation
description: Scaffold the proven production foundation for an Expo / React Native app — encrypted MMKV storage (key in SecureStore, canary, init timeout), SecureStore session adapter, Supabase client or API client with single-flight refresh, TanStack Query defaults with per-family snapshot cache, session-generation guard, full sign-out wipe, env validation, error boundary, safe native imports, signed-URL cache. Adapts to the existing code and never overwrites modules. Use when starting a new Expo app, when the user asks to "set up the base/foundation/core" of the app, or to fill gaps an audit found.
argument-hint: "[appPath] [--mode=direct-db|api|hybrid] [--only=storage,query,auth,api,env,errors]"
---

# expo-es-kit · foundation

You add the core modules that make an Expo app fast and safe by default. **Adapt** the templates to the project, never paste them blindly, and **never overwrite** an existing module.

## 0. Setup

- `PLUGIN_ROOT` is two levels above this SKILL.md. If unknown, run `find ~/.claude/plugins -type f -path '*expo-es-kit*/scripts/scan.mjs' | head -1` and strip `/scripts/scan.mjs`.
- The templates are in `PLUGIN_ROOT/skills/foundation/templates/code/`. Each one has a header that lists the deps it needs and how to adapt it.
- Run `node "$PLUGIN_ROOT/scripts/scan.mjs" <app> --summary > "$TMP/scan.json"` to learn:
  - the stack and libs
  - the backend mode (ask if it is `none`)
  - the folder layout (does it use `lib/` or `src/lib/`, and what import alias, e.g. `@/`)
  - which pieces already exist

## 1. Gap analysis

For each module, decide whether the app already has an equivalent. Search for the concept, not just the file name:

| Module | Template | Needed when |
|---|---|---|
| Encrypted app storage | `app-storage.ts` | Always, for any local persistence |
| Session storage adapter | `secure-session-storage.ts` | Supabase or any token auth |
| Supabase client | `supabase-client.ts` | direct-db / hybrid, or Supabase Auth |
| API client | `api-client.ts` | api / hybrid |
| Query client | `query-client.ts` | TanStack Query is used, or about to be |
| Snapshot cache | `query-snapshot-cache.ts` | You want cached-first screens across launches |
| Session generation | `session-generation.ts` | Any auth |
| Sign-out wipe | `sign-out.ts` | Any auth |
| Env validation | `env.ts` | Always |
| Error boundary | `error-boundary.tsx` | Always (expo-router) |
| Safe native import | `safe-native-import.ts` | Optional native modules (NetInfo, purchases, …) |
| Signed URL cache | `signed-url-cache.ts` | Private media from Supabase Storage / S3 |

Show the result as `| Module | Exists? (path) | Action: create / extend / skip | Deps to install |`.

- If a module exists but misses a critical property, propose a minimal **extend** diff instead of a new file. Examples: a session in AsyncStorage, no canary, sign-out that doesn't clear caches.
- Ask once for confirmation, as a multiSelect of the modules.

## 2. Dependencies

List the exact install command, e.g. `npx expo install react-native-mmkv expo-secure-store expo-crypto @tanstack/react-query zod`. **Ask the user to run it themselves.**

- Installs must run on the same OS the project normally uses. On Windows+WSL setups, installing from the wrong side breaks Metro.
- Point out which libs are native and therefore need a dev-client rebuild.

## 3. Write the modules

- Put each module in the project's conventional location (e.g. `lib/storage/app-storage.ts`) and use its import alias.
- Wire the modules together: the storage key prefixes are used by sign-out, the session generation is used by the query writes and the API client, and the env module is used by the clients.
- Integrate with the root layout (`app/_layout.tsx`):
  - the providers
  - the AppState listeners (auto-refresh, focusManager)
  - bounded storage init before the first cached render
  - the ErrorBoundary export
  - splash hide once the first real content is ready

  Show this diff separately. It is the riskiest one.
- Remove anything the project doesn't use, e.g. the Supabase parts in pure-API mode.

## 4. Verify

- Ask, then run the typecheck and lint.
- If the deps aren't installed yet, say that the typecheck is pending until the user runs the install command.
- List the manual checks:
  - cold start works offline
  - sign-in, kill the app, reopen: still signed in
  - sign-out: cached screens show no previous-user data
  - an expired token refreshes once and doesn't loop

## 5. Finish

Suggest `/expo-es-kit:setup` so the folder CLAUDE.md files reference the new modules (`{{STORAGE_MODULE}}`, `{{API_CLIENT_MODULE}}`, …), and `/expo-es-kit:audit --quick` to see the new baseline.
