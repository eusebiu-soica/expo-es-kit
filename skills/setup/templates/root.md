# {{APP_NAME}} — agent rules

Expo SDK {{EXPO_SDK}} app. Folder-level `CLAUDE.md` files hold the detailed rules; this file is the map and the non-negotiables.

**Stack:** Expo {{EXPO_SDK}} · {{ROUTER}} · {{QUERY_LIB}} · {{STATE_LIB}} · {{UI_LIB}} · {{STYLING}} · {{LIST_LIB}} · {{IMAGE_LIB}} · backend: {{BACKEND_MODE}}

## Commands

- Typecheck: `{{TYPECHECK_CMD}}` · Lint: `{{LINT_CMD}}` · Test: `{{TEST_CMD}}`
- New native module or config plugin → rebuild the dev client (`npx expo run:ios|android` or EAS dev build). JS reload is not enough.
- Install Expo packages with `npx expo install <pkg>` (SDK-matched versions), never bare `npm i`.

## Folder map

| Folder | What lives there | Rules |
|---|---|---|
| `app/` | Routes and layouts only | `app/CLAUDE.md` |
| `components/` | Presentational UI | `components/CLAUDE.md` |
| `hooks/` | Data and behavior hooks | `hooks/CLAUDE.md` |
| `lib/` | Pure modules, clients, query keys | `lib/CLAUDE.md` |
| `lib/storage/` | MMKV + SecureStore wrappers | `lib/storage/CLAUDE.md` |
| `stores/` | Client state ({{STATE_LIB}}) | `stores/CLAUDE.md` |
| `assets/` | Images, fonts, SVG | `assets/CLAUDE.md` |
| `modules/`, `plugins/` | Native modules, config plugins | `modules/CLAUDE.md` |

## Golden rules (non-negotiable)

- No secrets in the app. `EXPO_PUBLIC_*` is public; service keys and API secrets live on the server only.
- Tokens and credentials go in expo-secure-store via `{{SECURE_STORE_MODULE}}`. Never AsyncStorage, never plain MMKV.
<!-- if:mmkv -->
- Persisted app data goes through `{{STORAGE_MODULE}}` (encrypted MMKV, per-user key prefixes). No new `createMMKV` / `new MMKV` elsewhere.
<!-- endif -->
- Sign-out wipes everything: query cache, per-user storage, secure items, image cache, stores. Use the existing sign-out orchestrator; add new caches to it.
- Remote images use `{{IMAGE_LIB}}` with `cachePolicy="memory-disk"` and `recyclingKey` inside lists. No `Image` from `react-native` for remote URLs.
- Unbounded or >~20-item collections use `{{LIST_LIB}}`. No `ScrollView` + `.map()` over server data.
- Server state lives in {{QUERY_LIB}} only. Never copy query data into a global store.
- Import granularly (`date-fns/format`, per-component UI imports). No `moment`, no whole `lodash`, no barrel re-exports of heavy modules.
- No `console.log` outside `if (__DEV__)`. Never log tokens, sessions, emails or request bodies.
- Verify before saying done: typecheck, lint, tests, and exercise the change on a device or simulator when it touches UI, storage, or auth.
<!-- if:supabase -->
- One Supabase client: import from `{{SUPABASE_CLIENT_MODULE}}`. Never call `createClient` elsewhere.
<!-- endif -->
<!-- if:direct-db -->
- RLS is the trust boundary: every table the app queries has RLS + per-operation policies; the app never holds a service key.
<!-- endif -->
<!-- if:api -->
- One API client: import from `{{API_CLIENT_MODULE}}`. No raw `fetch` to the backend from screens or hooks.
<!-- endif -->

## Never

- Commit `.env*` files with real values, or paste keys into code, tests or fixtures.
- Put a token in a URL query string.
- Silence errors with empty `catch {}` or `@ts-ignore` to get green checks.
- Add a dependency without checking bundle cost and whether it needs a dev-client rebuild.

## Before finishing

- [ ] `{{TYPECHECK_CMD}}` and `{{LINT_CMD}}` pass; `{{TEST_CMD}}` passes for touched areas.
- [ ] Followed the folder `CLAUDE.md` of every folder you edited.
- [ ] New persisted data or cache is wiped on sign-out.
- [ ] No new secret, `console.log`, or `any` introduced.
- [ ] Before a release build: run `/expo-es-kit:audit` and fix every P0.
