# UI components — how to build here

Loaded when working in this folder. UI library: {{UI_LIB}}. Styling: {{STYLING}}.
Tokens live in `{{TOKENS_FILE}}` (+ `global.css`). Sheets open through `{{SHEET_HOST_MODULE}}`.

## Use

- {{UI_LIB}} primitives for all tappable chrome: `Button` (`isIconOnly` for icon buttons) and
  `PressableFeedback` for card-shaped pressables. Async actions: `Button` + `Spinner`.
- Granular imports only: `from "heroui-native/button"`, `"heroui-native/bottom-sheet"`, `"heroui-native/skeleton"`.
  Utilities: `cn` from `"heroui-native/utils"`, `useThemeColor` from `"heroui-native/hooks"`.
- Semantic token classes: `bg-background`, `bg-surface`, `text-foreground`, `text-muted`, `bg-accent`,
  `text-danger`, `border-border`, typography/spacing/radius classes from `{{TOKENS_FILE}}`.
- `tv()` (tailwind-variants) at module scope for component variants; `cn()` to merge a `className` override.
- `LoadingSkeleton` (skeleton bypass) for loading states: one per section, matching the real node's size.
- `useSheets().open(key, props)` from `{{SHEET_HOST_MODULE}}` to show a sheet. Sheet bodies are
  `*SheetContent` components registered in the sheet registry; they receive `onRequestClose`.
- Gorhom scrollables inside sheets: `BottomSheetScrollView`, `BottomSheetFlatList` (> 50 rows).

## Never

- `from "heroui-native"` (root) — except the provider in the root layout (prefer `heroui-native/provider`).
- Hex / rgb literals, `text-[17px]`, `p-[13px]`, `rounded-[18px]`, `fontSize: 17` in components.
  Missing token? Add it to `{{TOKENS_FILE}}` / `global.css` for every theme variant first.
- Raw `rgba()` — translucent colors go through the alpha/flatten helper (opaque over known solid backgrounds).
- Raw `Pressable` / `TouchableOpacity` for visible chrome (allowed only for invisible hit targets).
- A `<BottomSheet>` tree declared inside a screen — register a body and call `open()` instead.
- Animating `width`/`height`/`top`/`margin`; `entering` animations on list rows.
- Icon-only buttons without `accessibilityLabel`.
- Inline `style={{ … }}` for static values (inline only for animated, measured or computed runtime values).

## Patterns

```tsx
type StatCardProps = { isLoading?: boolean; label: string; value?: string; className?: string };

export const StatCard = memo(function StatCard({ isLoading, label, value, className }: StatCardProps) {
  return (
    <View className={cn("rounded-2xl bg-surface p-4", className)}>
      <Text className="text-sm text-muted">{label}</Text>
      <LoadingSkeleton isLoading={isLoading} className="mt-1 h-7 w-24 rounded-md" accessibilityLabel={label}>
        <Text className="text-2xl font-semibold text-foreground">{value ?? "-"}</Text>
      </LoadingSkeleton>
    </View>
  );
});
```

- Named exports, `<Name>Props` type, data components accept `isLoading?: boolean`.
- Memoize list rows and components under animated parents; hoist style/config objects to module scope.
- Sheets: choose fixed snap points + internal scroll, or dynamic height with a cap — set it in the registry.
- Theme-dependent JS values (SVG fill, RefreshControl tint): `useThemeColor` in the leaf that needs it.

## Before finishing

- [ ] No root `heroui-native` imports, no hex / arbitrary values / `fontSize` literals added.
- [ ] Every new interactive element has a role and (if icon-only) a label; targets ≥ 44pt (`hitSlop`).
- [ ] Looks right in light and dark (or the single shipped theme) and at large font scale.
- [ ] New sheets registered and opened via `open()`; long content scrolls; keyboard covered if inputs.
- [ ] Lists: rows memoized, stable keys, virtualization for unbounded data.
- [ ] Typecheck and lint pass.
