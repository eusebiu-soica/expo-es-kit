# HeroUI Native — audit checklist (category `heroui`)

Applies only when `heroui-native` is in `package.json`. Otherwise the category is `n/a`.
IDs are stable: findings use `HUI-01` … `HUI-30` as `id` (append `-a`, `-b` only if the same check yields
several distinct findings, e.g. `HUI-07-a`). Scan hits are signals; read the code before filing a finding.
Background: `performance.md`, `tokens.md`, `animations.md`, `accessibility.md` in this folder.

## Checks

### Performance

| Check-ID | What | How to verify | Severity | Fix |
|---|---|---|---|---|
| HUI-01 | Granular imports | `heroui-root-import` hits; any `from "heroui-native"` outside the root layout provider | P2 | Import from `heroui-native/<component>`; provider from `heroui-native/provider` |
| HUI-02 | Consistent import style per file | Files with both root and granular imports (`heroui-import` + `heroui-root-import` in same file) | P2 | Normalize the file to granular |
| HUI-03 | Closed sheets are not mounted | `heroui-bottom-sheet` hits across screens; ≥ 3 `<BottomSheet` roots in one screen or many screens with their own roots; no host/registry | P1 (sheet-heavy screens) / P2 | Single `SheetHost` + registry + `useSheets().open(key, props)` (`templates/sheet-host.tsx`) |
| HUI-04 | Sheet context split | Host exists; check that screens consume only stable actions, not active-sheet state | P2 | Separate actions and state contexts |
| HUI-05 | Skeleton bypass after load | `heroui-skeleton` hit count; per-text-node `<Skeleton>` in rows/cards; no wrapper | P1 on lists / measured jank, else P2 | `LoadingSkeleton` wrapper (`templates/skeleton-bypass.tsx`); one skeleton per section |
| HUI-06 | Long lists in sheets virtualized | Sheet bodies with `.map(` over unbounded data or > 50 rows; plain `FlatList`/`ScrollView` in sheet | P1 if unbounded, P2 | `BottomSheetFlatList` + fixed snap points; memo rows |
| HUI-07 | Overdraw from translucency | `with-alpha` hits in list rows / large fills over solid backgrounds; raw `rgba(` literals | P1 if overdraw confirmed in lists, else P2 | Pre-flatten over known solid backgrounds; keep alpha only over images/gradients/blur/backdrops |
| HUI-08 | Stable props to heavy primitives | Inline `snapPoints={[…]}`, inline `style={{…}}` / `animation={{…}}` on `BottomSheet.Content`, `Button` inside lists | P2 | Hoist constants, `useMemo`, `useCallback` |
| HUI-09 | Rows memoized (manual when React Compiler off) | `list-item-not-memo`, `memo` vs list count; `app.json` `reactCompiler` | P2 (P1 on long, frequently updated lists) | `memo` rows, stable callbacks |
| HUI-10 | Provider setup | `GestureHandlerRootView` outermost; one `HeroUINativeProvider`; `config` stable (not inline object); toast disabled if unused | P2 | Fix order; hoist `config` |
| HUI-11 | Theme reads don't re-render trees | `useThemeColor`/`useUniwind` in screen roots or list parents; own ThemeContext passing colors as props | P2 | Read theme in leaves; prefer `className` tokens |

### Tokens & styling

| Check-ID | What | How to verify | Severity | Fix |
|---|---|---|---|---|
| HUI-12 | No hardcoded colors in components | `hardcoded-hex` hits outside `global.css` / tokens module / tests | P2 (aggregate; escalate score cap per adoption table) | Map to semantic tokens (`bg-surface`, `text-muted`), add missing tokens |
| HUI-13 | No arbitrary Tailwind values for type/spacing/radius | `arbitrary-tw-value` hits | P2 | Add `@theme` tokens (`--text-*`, `--spacing-*`, `--radius-*`) |
| HUI-14 | No `fontSize` literals | `font-size-literal` hits | P2 | Typography scale classes / token constants |
| HUI-15 | Brand mapped onto HeroUI semantic variables | `global.css` overrides `--accent`, `--background`, `--surface`…; not just new parallel variables | P2 | Re-map HeroUI vars so stock components match the brand |
| HUI-16 | Dark/light parity | Diff variable names per `@variant` block in `global.css`; custom themes listed in `extraThemes` | P1 if a theme is unreadable, else P2 | Define every variable in every variant |
| HUI-17 | Token adoption ≥ 85% | Formula in `tokens.md` §6 | Score input (no finding unless < 70%: P2) | Migrate literals file by file, highest-traffic first |
| HUI-18 | Styling policy followed | `classname` vs `stylesheet-create` hits; mixing on same element | P2 | Pick one policy, document it in the UI CLAUDE.md |
| HUI-19 | Inline `style` only for runtime values | `inline-style` hits; static values inside `style={{}}` | P2 | Move static styles to classes; keep inline for animated/measured/computed values |
| HUI-20 | Variants via `tv`, merges via `cn` | `tv-variants` hits vs components with ad-hoc conditional class strings; template-literal class concatenation | P2 | `tv()` at module scope; `cn` from `heroui-native/utils` |

### Animations & gestures

| Check-ID | What | How to verify | Severity | Fix |
|---|---|---|---|---|
| HUI-21 | Transform/opacity only | `animated-layout-prop` hits | P1 on scroll/frequent paths, else P2 | Animate `transform` / `opacity` |
| HUI-22 | No entering animations on list rows / during nav transitions | grep `entering=` inside `renderItem` components and screen roots | P1 on lists, else P2 | Remove or gate after `transitionEnd` |
| HUI-23 | Reduced motion respected | Provider not forcing animations; own Reanimated code uses `ReduceMotion.System` or `useReducedMotion` (`reduced-motion` hits) | P2 | Add `reduceMotion` to configs / branch on hook |
| HUI-24 | Toolchain compatible | Reanimated v4 + `react-native-worklets` installed; worklets plugin last (or preset-managed); React Compiler status vs worklet bugs | P1 if broken/duplicated plugin, else note | Fix Babel config; disable compiler if conflicts observed |
| HUI-25 | Sheet layout correct | Snap sheets: body has pixel height, no `flex:1` chain under Gorhom view; dynamic sheets: `maxDynamicContentSize` + scrollable `maxHeight`; Gorhom scrollables inside sheets | P1 (empty/unscrollable sheet) / P2 | Apply mode A / B from `animations.md` §6 |
| HUI-26 | Sheet keyboard & focus | `keyboardBehavior` set for sheets with inputs; `BottomSheetTextInput` or `useBottomSheetAwareHandlers`; no `autoFocus` during open | P2 | Configure in registry; defer focus |
| HUI-27 | Haptics on key interactions | `expo-haptics` used on sheet open / confirmations, fired after state change | P2 (suggestion) | Centralize in host / helper |

### Accessibility & consistency

| Check-ID | What | How to verify | Severity | Fix |
|---|---|---|---|---|
| HUI-28 | Icon-only buttons labeled | `icon-only-button` hits vs `a11y-label` in the same element (read each) | P1 on primary flows, else P2 | `accessibilityLabel` (i18n) |
| HUI-29 | Tappable chrome uses HeroUI primitives | `raw-pressable` hits; exclude invisible hit targets | P2 | `Button` / `PressableFeedback` (feedback, a11y role, consistent press states) |
| HUI-30 | Touch targets ≥ 44pt / 48dp | `size="sm"` icon-only buttons, small custom pressables without `hitSlop` | P2 | `hitSlop` or padding |
| HUI-31 | Sheets accessible | Visible labeled close/cancel; Title first; iOS modal container prop or explicit focus | P1 if swipe-only dismiss, else P2 | `BottomSheet.Close` with label; focus management |
| HUI-32 | Font scaling capped, not disabled | Provider `textProps`; grep `allowFontScaling={false}` / global disable | P1 if disabled globally, else P2 | `maxFontSizeMultiplier` ~1.3–1.5 |
| HUI-33 | Loading states announced | Skeleton containers with `accessibilityState.busy` / label; async buttons busy | P2 | Use the skeleton-bypass wrapper's a11y props |
| HUI-34 | Contrast of custom tokens | Compute `foreground`/`muted` vs `background`/`surface` per theme | P1 if primary text < 4.5:1, else P2 | Adjust token values per theme |
| HUI-35 | Agent guidance present | `components/CLAUDE.md` (or UI folder) + path-scoped import rule exist and match the code | P2 (also feeds `agent-config`) | `templates/components-ui-claude.md`, `templates/heroui-imports-rule.md` |

## Score anchors (0–10, 0.5 steps; contract caps apply: confirmed P1 → max 7)

| Score | Looks like |
|---|---|
| **0–2** | HeroUI installed but fighting it: root imports everywhere, colors hardcoded throughout (adoption < 50%), multiple sheets per screen mounted eagerly, broken sheets (empty / unscrollable), icon-only buttons unlabeled, no dark/light parity. |
| **3–4** | Works but costly: several P1s (eager sheets on heavy screens, per-node skeletons in lists, layout-prop animations), adoption 50–70%, raw `Pressable` common for chrome. |
| **5–6** | Mostly idiomatic with gaps: granular imports mostly, one or two P1s, adoption 70–85%, some arbitrary values / fontSize literals, partial a11y labels. |
| **7–8** | Solid: no P1, granular imports, sheet host (or ≤ 2 sheets per screen), skeleton cost controlled, adoption 85–95%, labels on icon-only buttons, reduced motion respected; only P2 hygiene left. |
| **9–10** | Exemplary: all of 7–8 plus adoption ≥ 95%, overdraw handled deliberately, sheet modes encoded in a registry, theme parity verified, target sizes and font scaling tested, UI CLAUDE.md + import rule in place and followed. |

Quick-mode heuristic (scan only, no deep read): start at 7; −1 per P1-shaped signal (HUI-03, -05, -21, -28
at volume), −0.5 per P2 cluster (> 10 hits of one rule), +1 if a sheet host and skeleton wrapper exist
and adoption ≥ 90%. Clamp to anchors and contract caps.

## False-positive guidance

- **HUI-01**: root import of `HeroUINativeProvider` in the app root layout is tolerated (rule exempts it);
  type-only imports (`import type { … } from "heroui-native"`) cost nothing at runtime — downgrade or skip.
- **HUI-03**: a screen with one sheet, or sheets used inside a modal route, is fine. Gorhom
  `BottomSheetModal` used directly is out of scope unless it shows the same eager pattern.
- **HUI-05**: `Skeleton` used once per section, or `SkeletonGroup` with `isSkeletonOnly` placeholders, is fine.
- **HUI-07**: alpha over images, gradients, blur, video, maps, the sheet/dialog backdrop and floating bars
  over scrolling content is correct. `rgba(` inside the color helper itself is not a finding.
- **HUI-12/13/14**: hex/arbitrary values in `global.css`, token modules, generated color constants, SVG
  illustration components, chart configs that cannot take classes, tests, stories. Media dimensions
  (`w-[120px]` thumbnails) and hairlines are acceptable with a comment.
- **HUI-19**: `style={{ … }}` holding animated styles, insets, measured sizes or computed token colors is the
  intended use.
- **HUI-28**: `isIconOnly` with `accessibilityLabel` passed via a spread (`{...a11y}`) or set inside a wrapper
  component — read the wrapper before filing.
- **HUI-29**: raw `Pressable` for invisible hit areas (chart points, overlay dismiss, the sheet backdrop) or
  inside a reusable primitive that itself adds feedback and a11y.
- Generated code, vendored components and `node_modules` copies are out of scope.
