# app/ — agent rules

Route files and layouts for {{ROUTER}}. Screens compose hooks and components; they do not own logic.

## Use

- Thin route files: read params, call hooks from `hooks/`, render components. Move anything over ~150 lines out.
- Typed routes (`experiments.typedRoutes`): `router.push({ pathname: '/item/[id]', params: { id } })`, `<Link href=...>`.
- Validate every route/deep-link param with zod (or a guard) before use; treat params as untrusted input.
- `export function ErrorBoundary` in layouts that wrap risky subtrees (data-heavy stacks, webviews).
- Nested `Stack`: set `screenOptions={{ freezeOnBlur: true, contentStyle: { backgroundColor: <theme bg> } }}` explicitly. Defaults differ per navigator and a missing `contentStyle` shows a white flash.
- Heavy, rarely-visited screens (charts, editors, maps): lazy-load the heavy component inside the screen.
- Auth gating in the layout (`<Redirect>` or `Stack.Protected`), not inside each screen.

## Never

- Fetch with `fetch`/`useEffect` in a route file. Data comes from query hooks.
- Run mount/entering animations while the screen transition is running (double animation, dropped frames). Defer with `onTransitionEnd` / `useFocusEffect` or skip on first mount.
- Touch `SplashScreen` outside the root `_layout.tsx`.
- Trust `id`/`userId` params for authorization; the server or RLS decides access.
- Put secrets, tokens or PII in route params (they end up in URLs, logs and analytics).
- Mount every tab's data on start; let focus drive fetching.

## Patterns

```tsx
// app/item/[id].tsx
const Params = z.object({ id: z.string().uuid() });

export default function ItemScreen() {
  const parsed = Params.safeParse(useLocalSearchParams());
  if (!parsed.success) return <Redirect href="/" />;
  return <ItemDetail id={parsed.data.id} />; // ItemDetail calls useItem(id)
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ErrorView error={error} onRetry={retry} />;
}
```

```tsx
// app/_layout.tsx — the only place that touches the splash screen
SplashScreen.preventAutoHideAsync();
export default function RootLayout() {
  const ready = useAppReady(); // fonts + storage init + session restore
  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;
  return <Providers><Stack screenOptions={{ freezeOnBlur: true, contentStyle: { backgroundColor: bg } }} /></Providers>;
}
```

## Before finishing

- [ ] Route file only wires params → hooks → components; params validated.
- [ ] Nested stacks set `freezeOnBlur` and `contentStyle`.
- [ ] No animation fires during the push/pop transition.
- [ ] Deep link to the screen tested with a bad/missing param (no crash).
- [ ] `{{TYPECHECK_CMD}}` passes (typed routes catch broken hrefs).
