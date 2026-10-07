# components/ — agent rules

Presentational UI. Props in, JSX out. Data fetching lives in `hooks/`, not here.

## Use

<!-- if:compiler -->
- React Compiler is ON: do not add `memo`/`useMemo`/`useCallback` by reflex. Keep components pure so the compiler can memoize; add manual memo only where a profile proves it.
<!-- endif -->
<!-- if:!compiler -->
- React Compiler is OFF: `memo()` list items and expensive children; pass them stable props (`useCallback` handlers, `useMemo` derived objects).
<!-- endif -->
- Stable keys from data ids. Never index keys for reorderable or paginated data.
- Lists: `{{LIST_LIB}}` for anything unbounded or >~20 rows. Measure first (Perf Monitor / profiler) before tuning; fix item render cost before list props.
<!-- if:flashlist -->
- FlashList: `getItemType` for heterogeneous rows; no `key` prop inside items; reset per-item state on `item.id` change (cells are recycled).
<!-- endif -->
- `{{IMAGE_LIB}}`: `cachePolicy="memory-disk"`, `recyclingKey={item.id}` in lists, thumbnail/preview URLs sized for the slot (never full-size originals in a grid), `placeholder` + `transition` ≤ 200ms.
- Animations: Reanimated on `transform` and `opacity` only. Respect reduced motion (`useReducedMotion()` → skip or shorten).
- Overdraw: on solid backgrounds, pre-flatten translucent colors to an opaque equivalent instead of stacking `rgba`/alpha layers.
- One bottom-sheet host at app level; components request sheets, they do not mount their own host.
- Skeletons: render only while `isPending` with no data; once data exists, never show the skeleton again (refetches keep content).
- Icon-only buttons: `accessibilityLabel` (and `accessibilityRole="button"` on custom pressables); hit area ≥ 44pt.
<!-- if:heroui -->
- HeroUI Native: granular imports (`heroui-native/button`), theme tokens and variants, no hard-coded hex or arbitrary `[..]` values.
<!-- endif -->

## Never

- Inline objects/arrays/arrows passed to memoized children or list `renderItem` (`style={{...}}`, `onPress={() => ...}`) when the compiler is off.
- Side effects in the render body (writes, subscriptions, `storage.set`, analytics). Use effects or event handlers.
- `useRef(expensive())` — use lazy init: `const ref = useRef<T | null>(null); if (ref.current === null) ref.current = expensive();`.
- `.find()`/`.filter()` inside `.map()` (O(n²)). Build a `Map` by id once with `useMemo`.
- Constants, formatters, regexes recreated per render. Hoist to module scope.
- Animate `width`/`height`/`top`/`margin`/layout props.
- `ScrollView` + `.map()` over server data.

## Patterns

```tsx
const formatter = new Intl.NumberFormat('en-US'); // hoisted invariant

const Row = memo(function Row({ item, user, onPress }: RowProps) {
  return (
    <Pressable onPress={() => onPress(item.id)} accessibilityRole="button">
      <Image source={{ uri: item.thumbUrl }} recyclingKey={item.id} cachePolicy="memory-disk" style={styles.thumb} />
      <Text>{user?.name} · {formatter.format(item.total)}</Text>
    </Pressable>
  );
});

function List({ items, users }: Props) {
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const onPress = useCallback((id: string) => router.push(`/item/${id}`), []);
  const renderItem = useCallback(({ item }) => <Row item={item} user={usersById.get(item.userId)} onPress={onPress} />, [usersById, onPress]);
  return <FlashList data={items} renderItem={renderItem} keyExtractor={(i) => i.id} />;
}
```

## Before finishing

- [ ] No inline props into memoized children (compiler off) / component stays pure (compiler on).
- [ ] Lists virtualized, keys stable, images with `recyclingKey` + sized URLs.
- [ ] Animations only `transform`/`opacity`; reduced motion handled.
- [ ] Icon-only controls have `accessibilityLabel`.
- [ ] `{{TYPECHECK_CMD}}` and `{{LINT_CMD}}` pass; scrolled the screen on a device.
