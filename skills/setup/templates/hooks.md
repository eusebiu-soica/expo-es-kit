# hooks/ — agent rules

Data and behavior hooks. Screens and components call these; hooks call `lib/` clients and {{QUERY_LIB}}.

## Use

- One hook per query family: `useItems(filters)`, `useItem(id)`, `useUpdateItem()`. Query keys come from the key factories in `lib/` only.
- `select` to derive/narrow data so components re-render only on what they read.
- `enabled: !!id` for dependent queries; never call a query with an `undefined` key part.
- Mutations: `onSuccess` invalidates the narrowest family (`keys.items.detail(id)`, `keys.items.lists()`), or `setQueryData` when the response is the new truth.
- Optimistic updates: `onMutate` snapshots + `cancelQueries`, `onError` rolls back, `onSettled` invalidates.
- Capture the session generation before async work that writes to caches/stores; drop the write if it is no longer current.
- Clean up every subscription, listener, timer and realtime channel in the effect cleanup.
- `useFocusEffect` (not `useEffect`) for work that should pause when the screen is not visible.

## Never

- `fetch` + `useState` + `useEffect` for server data. Use a query hook.
- Copy query data into {{STATE_LIB}} or `useState` "to cache it".
- `invalidateQueries()` with no key (refetches the whole app).
- Return new object/array literals from a hook every render when callers depend on identity; memoize or return primitives.
- Read storage or SecureStore synchronously inside a hot render path.
- Swallow errors: surface them via the query `error` or rethrow from `mutationFn`.

## Patterns

```ts
export function useItems(filters: ItemFilters) {
  return useQuery({
    queryKey: keys.items.list(filters),
    queryFn: ({ signal }) => fetchItems(filters, { signal }),
    select: (rows) => rows.filter((r) => !r.archived),
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateItem,
    onSuccess: (item) => {
      qc.setQueryData(keys.items.detail(item.id), item);
      qc.invalidateQueries({ queryKey: keys.items.lists() });
    },
  });
}

// Late-write guard
const gen = captureGeneration();
const data = await loadSomething();
if (!isCurrent(gen)) return; // signed out / switched account meanwhile
```

## Before finishing

- [ ] Keys from the factory; invalidation scoped to a family.
- [ ] `signal` passed to the fetcher so unmount cancels the request.
- [ ] Every subscription/channel/timer cleaned up.
- [ ] Async writes guarded by the session generation.
- [ ] `{{TYPECHECK_CMD}}` and `{{TEST_CMD}}` pass.
