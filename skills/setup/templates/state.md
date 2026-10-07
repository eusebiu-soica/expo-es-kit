# state — agent rules

Client state with {{STATE_LIB}}. Server state lives in {{QUERY_LIB}}, never here.

## Use

- Decide first: does it come from the server? → query hook. Is it UI/session-local (filters, selection, draft, theme)? → {{STATE_LIB}} or component state.
- Smallest scope that works: component state → context for a subtree → global store only when truly app-wide.
<!-- if:zustand -->
- zustand: select narrow slices (`useStore((s) => s.filter)`); use `useShallow` when selecting several fields.
- Register every store with a `reset()` in the store registry so sign-out can reset it.
<!-- endif -->
<!-- if:jotai -->
- jotai: small atoms; derived atoms for computed values; reset user atoms on sign-out via the registry (`RESET` / `atomWithReset`).
<!-- endif -->
- Query defaults (in `lib/`): `staleTime` 60s, `gcTime` 10min, `retry` 1, mutations `retry` 0, `refetchOnWindowFocus` false (AppState drives focus).
- Invalidate by family (`keys.items.lists()`), never the whole cache.
- Persist selected query families as snapshots (TTL + shape guard) via `query-snapshot-cache`, not the whole cache. High-churn families stay memory-only.
- Session-generation guard on async writes: capture before `await`, drop the write if no longer current.
- Persisted client state: through `{{STORAGE_MODULE}}` with a user prefix and a version.

## Never

- Copy query data into a global store (`setItems(data)` in `onSuccess`). Two sources of truth drift.
- Subscribe to the whole store (`useStore()` with no selector) in components.
- Store tokens or secrets in {{STATE_LIB}} state that gets persisted or logged.
- `persistQueryClient` / whole-cache persistence.
- Keep a user's state alive across sign-out or account switch.

## Patterns

```ts
// zustand store with reset registered for sign-out
const initial = { filter: 'all' as Filter, selectedId: null as string | null };
export const useUiStore = create<typeof initial & { setFilter(f: Filter): void; reset(): void }>()((set) => ({
  ...initial,
  setFilter: (filter) => set({ filter }),
  reset: () => set(initial),
}));
registerStoreReset(() => useUiStore.getState().reset());

// read server data via a query, client state via a selector
const filter = useUiStore((s) => s.filter);
const { data } = useItems({ filter });
```

## Before finishing

- [ ] No server data duplicated in a store.
- [ ] New store/atom resets on sign-out (registered).
- [ ] Selectors are narrow; no whole-store subscriptions.
- [ ] Persisted state is versioned and user-prefixed.
- [ ] `{{TYPECHECK_CMD}}` and `{{TEST_CMD}}` pass.
