# CLAUDE.md templates

The `setup` skill fills these templates and writes each one as a `CLAUDE.md` in the matching folder of the user's app (or API project). They are loaded into agent context on every task in that folder, so each stays under ~80 lines. Edit for brevity, never pad.

## Placeholder syntax

`{{NAME}}` is replaced verbatim. Every placeholder must be resolved before writing; if a value is unknown, drop the line that uses it rather than leaving `{{...}}` in the output.

| Placeholder | Example value | Source |
|---|---|---|
| `{{APP_NAME}}` | `Acme` | `app.json` → `expo.name` |
| `{{EXPO_SDK}}` | `54` | `expo` version in `package.json` |
| `{{ROUTER}}` | `expo-router` | dependencies |
| `{{STATE_LIB}}` | `zustand` / `jotai` / `none` | dependencies |
| `{{QUERY_LIB}}` | `@tanstack/react-query` | dependencies |
| `{{STORAGE_MODULE}}` | `@/lib/storage/app-storage` | import path of the app's MMKV wrapper |
| `{{SECURE_STORE_MODULE}}` | `@/lib/storage/secure-session-storage` | import path of the SecureStore wrapper |
| `{{API_CLIENT_MODULE}}` | `@/lib/api/api-client` | import path of the single API client |
| `{{SUPABASE_CLIENT_MODULE}}` | `@/lib/supabase` | import path of the single Supabase client |
| `{{UI_LIB}}` | `heroui-native` / `none` | dependencies |
| `{{STYLING}}` | `nativewind` / `uniwind` / `StyleSheet` | dependencies |
| `{{LIST_LIB}}` | `@shopify/flash-list` / `@legendapp/list` / `FlatList` | dependencies |
| `{{IMAGE_LIB}}` | `expo-image` | dependencies |
| `{{TEST_CMD}}` | `npm test` | `package.json` scripts |
| `{{TYPECHECK_CMD}}` | `npx tsc --noEmit` | `package.json` scripts |
| `{{LINT_CMD}}` | `npm run lint` | `package.json` scripts |
| `{{BACKEND_MODE}}` | `direct-db` / `api` / `hybrid` / `none` | `scripts/detect-mode.mjs` |

For `server/*` templates, `{{TEST_CMD}}`, `{{TYPECHECK_CMD}}` and `{{LINT_CMD}}` are resolved against the API project's `package.json`, not the app's.

## Conditional blocks

```md
<!-- if:mmkv -->
Only kept when the `mmkv` flag is on.
<!-- endif -->
```

- Keep the content and delete both marker lines when the flag is on; delete the whole block when it is off.
- `<!-- if:!compiler -->` negates a flag. `<!-- if:api|hybrid -->` is OR. Blocks do not nest.
- Strip every marker from the output; no `<!-- if` / `<!-- endif` may remain.

| Flag | On when |
|---|---|
| `heroui` | `heroui-native` installed |
| `mmkv` | `react-native-mmkv` installed |
| `supabase` | `@supabase/supabase-js` installed |
| `direct-db` | `BACKEND_MODE` is `direct-db` or `hybrid` |
| `api` | `BACKEND_MODE` is `api` or `hybrid` |
| `compiler` | React Compiler enabled (`experiments.reactCompiler` or babel plugin) |
| `flashlist` / `legendlist` | that list library installed |
| `zustand` / `jotai` | that state library installed |
| `nativewind` | `nativewind` or `uniwind` installed |
| `sentry` | `@sentry/react-native` installed |

## Template → destination

| Template | Written to (adjust to the app's real folders) |
|---|---|
| `root.md` | `<app>/CLAUDE.md` (rewrite the folder map to real paths; drop rows for absent folders) |
| `app-routes.md` | `app/CLAUDE.md` (or `src/app/`) |
| `components.md` | `components/CLAUDE.md` |
| `hooks.md` | `hooks/CLAUDE.md` |
| `lib.md` | `lib/CLAUDE.md` (or `src/lib/`, `utils/`) |
| `storage.md` | folder containing `{{STORAGE_MODULE}}` |
| `state.md` | `stores/` / `state/` folder |
| `assets.md` | `assets/CLAUDE.md` |
| `native-modules.md` | `modules/` or `plugins/` (skip if neither exists and no config plugins) |
| `tests.md` | `__tests__/` or `tests/` |
| `data/direct-db.md` | folder holding Supabase queries (direct-db / hybrid) |
| `data/api-client.md` | folder containing `{{API_CLIENT_MODULE}}` (api / hybrid) |
| `server/nextjs-api.md` | `<api>/app/api/CLAUDE.md` |
| `server/supabase-edge.md` | `supabase/functions/CLAUDE.md` |
| `server/expo-api-routes.md` | the folder holding `+api.ts` files |
| `server/db-migrations.md` | `supabase/migrations/CLAUDE.md` (or the migrations folder) |

If a folder already has a `CLAUDE.md`, merge: keep the user's lines, add missing rules under the same headings, never delete user content without asking.
