# lib/ — agent rules

Pure modules, singletons (clients) and query key factories. No UI.

## Use

- Pure functions in pure modules: no `react` / `react-native` imports in formatting, validation, mapping or math files. They must run in plain Node tests.
- Singletons created once at module scope and imported everywhere:
<!-- if:supabase -->
  - Supabase client: `{{SUPABASE_CLIENT_MODULE}}` (the only `createClient` call).
<!-- endif -->
<!-- if:api -->
  - API client: `{{API_CLIENT_MODULE}}` (the only place that calls `fetch` against the backend).
<!-- endif -->
  - QueryClient: one instance, created in `lib/`, provided in the root layout.
- Query key factories per family, hierarchical, returned `as const`.
- Optional native modules (NetInfo, haptics, analytics SDKs) behind a lazy, guarded import (`safe-native-import`), resolved on first use.
- Config through the validated `env` module only; never read `process.env.EXPO_PUBLIC_*` ad hoc.
- Logging via a tiny logger that is a no-op unless `__DEV__`; redact tokens, emails, ids.
- Explicit return types on exported functions; narrow `unknown` from the network with zod.

## Never

- Module-scope `import` of an optional native module (crashes stale dev clients and tests at import time).
- Side effects at import time other than creating the declared singleton (no network calls, no storage writes).
- A second Supabase/API/QueryClient instance, even "just for this feature".
- Barrel files (`index.ts` re-exporting everything) for heavy modules; they defeat tree-shaking and slow startup.
- `any` on network boundaries. Parse, then type.
- `console.log` without `__DEV__`.

## Patterns

```ts
// lib/query-keys.ts
export const keys = {
  items: {
    all: ['items'] as const,
    lists: () => [...keys.items.all, 'list'] as const,
    list: (f: ItemFilters) => [...keys.items.lists(), f] as const,
    detail: (id: string) => [...keys.items.all, 'detail', id] as const,
  },
};

// lib/log.ts
export const log = (...args: unknown[]) => { if (__DEV__) console.log(...args); };

// lazy optional native module
const netInfo = lazyNativeModule(() => require('@react-native-community/netinfo').default, 'NetInfo');
```

## Before finishing

- [ ] Pure files import nothing from React/React Native.
- [ ] No new client instance; reused the singleton.
- [ ] Optional native modules imported lazily and guarded.
- [ ] Unit tests for new pure functions; `{{TEST_CMD}}` and `{{TYPECHECK_CMD}}` pass.
