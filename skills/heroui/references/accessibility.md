# HeroUI Native — accessibility

What HeroUI gives you and what it doesn't. Verified in `heroui-native@1.0.x` source; re-check on upgrade.

| Built in | Not built in (your job) |
|---|---|
| `Button` defaults `accessibilityRole="button"` and sets `accessibilityState.disabled` | A label for `isIconOnly` buttons |
| `BottomSheet.Title` / `Description` carry heading role and link to the sheet | Focus placement when a sheet opens / closes |
| Reduced motion disables all HeroUI animations (via Reanimated `useReducedMotion`) | Reduced motion for your own animations |
| `HeroUINativeProvider config.textProps` (global `maxFontSizeMultiplier`, `allowFontScaling`) | Layouts that survive large text |
| Theme tokens with paired `-foreground` colors | Verifying contrast of your custom tokens |
| — | Loading announcements for `Skeleton` (it renders plain views) |

Scan hits: `a11y-label`, `icon-only-button`, `raw-pressable`. Compare counts: `icon-only-button` hits
should be ≤ the number of those elements that have a label; a large gap is a finding.

## 1. Labels and roles

- Every interactive element exposes a name and a role.
  - Text buttons: the visible text is the name; no extra label needed (add one only if the text is ambiguous:
    "Edit" → "Edit phone number").
  - **Icon-only** (`<Button isIconOnly>`, `PressableFeedback` wrapping only an icon, `BottomSheet.Close`
    with a custom icon): `accessibilityLabel` is mandatory. Use a verb + object ("Close", "Open filters",
    "Delete photo"), localized through i18n, not the icon name.
  - `PressableFeedback` used as a card: `accessibilityRole="button"` (or `"link"` if it navigates) and a
    label summarizing the card ("Jane Doe, 3 sessions this week").
- `accessibilityHint` only for non-obvious outcomes ("Opens the camera").
- State: `accessibilityState={{ selected, checked, disabled, busy, expanded }}` on custom toggles, tabs,
  chips. HeroUI `Checkbox`, `Switch`, `Radio`, `Tabs` handle this themselves; custom look-alikes must too.
- Decorative visuals (chart overlays, background shapes, duplicated icons next to text):
  `accessible={false}`, `accessibilityElementsHidden` (iOS), `importantForAccessibility="no-hide-descendants"` (Android).
- Group compound rows so the screen reader reads one item, not five fragments: `accessible` on the row
  container with a combined label.
- Raw `Pressable` for chrome (scan: `raw-pressable`) is usually also missing role/label — check both.

## 2. Target size

- Minimum touch target: **44×44 pt** (Apple HIG) / **48×48 dp** (Material). Visual size can be smaller.
- HeroUI `Button size="sm"` with `isIconOnly` may render below that — verify the rendered size and add
  `hitSlop` (e.g. `{ top: 8, bottom: 8, left: 8, right: 8 }`) or padding.
- Keep at least 8 dp between adjacent targets; `hitSlop` must not overlap a neighbour's target.
- Invisible hit targets (chart points, map pins) are the legitimate use of raw `Pressable`; they still need
  a label and an adequate area.

## 3. Contrast and color

- Text vs background: **4.5:1** normal text, **3:1** large text (≥ 18 pt regular / 14 pt bold) and
  essential UI parts (icons, focus rings, input borders) — WCAG 2.1 AA.
- Always pair `bg-X` with `text-X-foreground`; HeroUI's defaults are designed as pairs. When you override
  `--accent`, recompute `--accent-foreground` per theme.
- Check `--muted` on `--surface` and on `--background` in **both** themes; muted text is the usual failure.
- Pre-flattened translucent colors (performance.md §4) make contrast checking easier — the composited
  color is known. For text over images or blur, add a scrim token and check against the darkest/lightest frame.
- Never convey state by color alone: add an icon, label or pattern for success/danger/selected.
- Test with system "Increase Contrast" (iOS) / high-contrast text (Android) if you claim support.

## 4. Sheets, dialogs and focus order

- When a sheet opens, screen-reader focus must move into it (first heading or first control) and must not
  stay on the screen behind.
  - iOS: `BottomSheet.Portal unstable_accessibilityContainerViewIsModal` makes VoiceOver treat the sheet as
    modal (unstable API — verify on upgrade). `Dialog.Portal` accepts the same prop.
  - Put `BottomSheet.Title` (heading) first in the content so it is the first focus stop.
  - If you need explicit focus: `AccessibilityInfo.setAccessibilityFocus(findNodeHandle(ref.current))` after
    the open animation (sheet `onChange` index ≥ 0).
- Every sheet must be dismissible without a gesture: a visible close button (`BottomSheet.Close` with a
  label) or a cancel action. Swipe-down alone fails for switch-access and many screen-reader users.
- Android back button closes the topmost sheet (verify with your host).
- On close, return focus to the trigger when practical (store a ref to the trigger in the host).
- Order inside the sheet follows visual order; avoid absolute-positioned footers that read before content.

## 5. Dynamic type / font scaling

- Do not disable scaling globally. If the design breaks, cap it: `config={{ textProps: { maxFontSizeMultiplier: 1.5 } }}`
  on `HeroUINativeProvider` (HeroUI text components), and the same `maxFontSizeMultiplier` on your own `Text`
  via a shared `AppText` wrapper (`Text.defaultProps` is unreliable on modern React / RN).
- `allowFontScaling={false}` only for elements that are not text content (tab-bar badges with 1–2 digits,
  icon glyph fonts).
- Layout: rows must wrap or grow (`flex-wrap`, `min-h-*` instead of fixed `h-*`) at 1.5× text. Fixed-height
  `Skeleton` placeholders are fine; fixed-height containers for the loaded text are not.
- Test at the largest accessibility size on iOS and "Font size: largest" + "Display size: largest" on Android.

## 6. Loading, skeletons and live updates

`Skeleton` renders plain animated views: a screen reader either reads nothing or reads empty elements.
- On the section container while loading: `accessibilityState={{ busy: true }}` and a label such as
  "Loading sessions" (the skeleton-bypass template does this). Hide individual placeholder bars from
  accessibility.
- When content arrives, announce only if it changed meaningfully and the user is waiting for it:
  `AccessibilityInfo.announceForAccessibility("Results loaded")`. Do not announce every background refresh.
- Async buttons: HeroUI `Button` + `Spinner`; set `accessibilityState={{ busy: true, disabled: true }}` and
  keep the label stable ("Save", not "Loading…" replacing it with no context).
- Toasts/errors: errors that block the user should be announced (or rendered with
  `accessibilityLiveRegion="polite"` on Android) and must remain readable long enough (no 2-second auto-dismiss
  for errors).

## 7. Verify

- iOS: VoiceOver + Accessibility Inspector (audit tab flags missing labels and small targets).
- Android: TalkBack + Accessibility Scanner.
- Automated hint: `@testing-library/react-native` queries by role/label (`getByRole("button", { name })`)
  fail when labels are missing — cheap regression tests for icon-only buttons.

## Severity guide

| Situation | Severity |
|---|---|
| Icon-only buttons without labels on primary flows (nav, close, submit) | P1 |
| Sheet cannot be dismissed without swipe, or focus stays behind the sheet | P1 |
| Primary text contrast < 4.5:1 in a shipped theme | P1 |
| Font scaling disabled app-wide (`allowFontScaling: false` globally) | P1 |
| Targets < 44pt without hitSlop, decorative elements read aloud, no loading busy state | P2 |
