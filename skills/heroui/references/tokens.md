# HeroUI Native — design tokens

HeroUI Native styles everything through Uniwind (Tailwind CSS v4 for React Native). Tokens are CSS
variables declared in `global.css`; Tailwind utilities (`bg-accent`, `text-muted`, `rounded-xl`) resolve
to them. One source of truth, two consumers: `className` (preferred) and JS (`useThemeColor`).

Scan hits that feed this file: `hardcoded-hex`, `arbitrary-tw-value`, `font-size-literal`, `classname`,
`inline-style`, `stylesheet-create`, `tv-variants`, `with-alpha`.

## 1. Setup (verify against the installed version)

```css
/* global.css */
@import "tailwindcss";
@import "uniwind";
@import "heroui-native/styles";
@source "./node_modules/heroui-native/lib"; /* path relative to global.css; may be unnecessary in newer 1.0.x */
```

`metro.config.js` wraps the config with `withUniwindConfig(config, { cssEntryFile: "./global.css", dtsFile, extraThemes })`.
Custom themes beyond `light` / `dark` must be listed in `extraThemes`.

## 2. Semantic color tokens (HeroUI defaults)

Naming: the bare name is the fill, `-foreground` is the content color on that fill.

| Group | Variables | Utility examples |
|---|---|---|
| Base | `--background`, `--foreground` | `bg-background`, `text-foreground` |
| Surface (cards, non-overlay) | `--surface`, `--surface-secondary`, `--surface-tertiary` (+ `-foreground`) | `bg-surface`, `bg-surface-secondary` |
| Overlay (dialogs, sheets, menus) | `--overlay`, `--overlay-foreground`, `--backdrop` | `bg-overlay` |
| Brand / emphasis | `--accent`, `--accent-foreground`, `--default`, `--default-foreground` | `bg-accent`, `text-accent-foreground` |
| Status | `--success`, `--warning`, `--danger` (+ `-foreground`) | `text-danger`, `bg-success` |
| Text | `--muted` | `text-muted` |
| Lines / focus | `--border`, `--separator`, `--focus`, `--link` | `border-border` |
| Fields | `--field-background`, `--field-foreground`, `--field-placeholder`, `--field-border` | `bg-field` |
| Shadows | `--surface-shadow`, `--overlay-shadow`, `--field-shadow` | `shadow-surface`, `shadow-overlay` |
| Primitives (theme-independent) | `--white`, `--black`, `--snow`, `--eclipse` | — |

Values are defined per theme in `@layer theme { :root { @variant light { … } @variant dark { … } } }`.
The library's dark theme intentionally drops surface shadows (elevation by color, not shadow).

### Overriding and extending

```css
@layer theme {
  :root {
    @variant light { --accent: oklch(0.62 0.19 254); --info: oklch(0.6 0.15 210); --info-foreground: oklch(0.98 0 0); }
    @variant dark  { --accent: oklch(0.70 0.16 254); --info: oklch(0.7 0.13 210); --info-foreground: oklch(0.15 0 0); }
  }
}
@theme inline {
  --color-info: var(--info);
  --color-info-foreground: var(--info-foreground);
}
```

Rules:
- Re-map HeroUI's semantic variables to your brand first (`--accent`, `--background`, `--surface`, …) so
  stock components pick up the brand with zero per-component overrides.
- New semantic colors: add the variable in **every** theme variant, then expose it via `@theme inline`.
- **Dark/light parity**: every variable defined in one variant must exist in all others (the docs require it).
  Audit by diffing the variable names per `@variant` block.
- Dark-only apps: still define the token, just one variant — never hardcode the dark hex in components.

## 3. Typography, spacing, radius

- **Radius**: HeroUI derives the scale from one variable `--radius` (default `0.5rem`):
  `rounded-xs … rounded-4xl` = `--radius × 0.25 … × 4`, `--field-radius` = `--radius × 1.5`.
  Change `--radius` to re-skin all corners. Brand-specific radii: add `--radius-brand-lg` etc. in `@theme`
  and use `rounded-brand-lg` — not `rounded-[18px]`.
- **Spacing**: Tailwind's 4px scale (`p-4` = 16px). Add named tokens for layout constants
  (`--spacing-gutter`, `--spacing-section`) when the design uses non-scale values repeatedly.
- **Typography**: define the scale in `@theme` (`--text-title: 1.75rem; --text-title--line-height: 2.25rem;`)
  and font families (`--font-sans`, `--font-display`). Components use `text-title`, `font-display`,
  never `fontSize: 17` or `text-[17px]`.
- **Shadows / elevation**: `shadow-surface` / `shadow-overlay` or your own `--shadow-*`. Keep platform
  differences (Android elevation) inside the token, not in components.
- **Icon sizes and stroke**: one constant module (`ICON_SIZE`, `ICON_STROKE`) shared by all icons.

## 4. Where literals are allowed

| Literal | Allowed in | Not allowed in |
|---|---|---|
| Hex / rgb / oklch values | `global.css`, the project's tokens module, generated flattened-color constants | Components, screens |
| `text-[…]`, `p-[…]`, `rounded-[…]`, `w-[…]`, `h-[…]` | Rare one-offs with a comment (hairline, image aspect); fixed sizes for media | Typography, padding, radius, gaps |
| `fontSize: n` | Nowhere outside the tokens file | Everywhere else |
| `style={{ … }}` inline | Runtime values: animated styles, measured sizes, computed colors from tokens, safe-area insets | Static layout that a class can express |
| `StyleSheet.create` | Projects whose stated policy allows it, for non-tokenized static styles | Mixing with `className` on the same element without reason |

Style precedence: `style` beats `className`; Reanimated animated styles beat both. HeroUI exposes
`isAnimatedStyleActive={false}` on many parts so your `className` can win over an internal animation.

## 5. Variants and overrides

- Component variants: `tv()` from `tailwind-variants` (a HeroUI peer dependency). Put the `tv` definition
  at module scope, export the props type with `VariantProps<typeof x>`.
- Merge caller overrides with `cn` from `heroui-native/utils` (wraps `tailwind-merge`, aware of HeroUI's
  custom classes). Never concatenate class strings with template literals when classes can conflict.
- Reuse HeroUI's style slots for look-alike custom components: every component exports
  `xClassNames` (e.g. `buttonClassNames`, `skeletonClassNames`).
- Third-party components without `className`: wrap with `withUniwind(Component)` from `uniwind`.
- JS-only color props: `useThemeColor("accent")` / `useThemeColor(["accent", "muted"])` from `heroui-native/hooks`.

```tsx
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "heroui-native/utils";

const badge = tv({
  base: "rounded-full px-2 py-0.5",
  variants: { tone: { neutral: "bg-default", danger: "bg-danger" } },
  defaultVariants: { tone: "neutral" },
});
type BadgeProps = VariantProps<typeof badge> & { className?: string };
// <View className={cn(badge({ tone }), className)} />
```

## 6. Measuring token adoption

Use the scan hits (counts over app `.tsx` files, excluding the tokens file, `global.css`, tests, stories).

```
colorLiterals  = hits(hardcoded-hex) + rgba/rgb literals not wrapped in a helper (grep `rgba?\(` minus helper calls)
sizeLiterals   = hits(arbitrary-tw-value) + hits(font-size-literal)
tokenUsages    = className lines with a token utility
                 (grep -E '(bg|text|border|fill|stroke)-(background|foreground|surface|overlay|accent|default|muted|success|warning|danger|border|separator|field)|rounded-(xs|sm|md|lg|xl|2xl|3xl|4xl|field)|text-(xs|sm|base|lg|xl|[2-9]xl)')
                 + useThemeColor( calls + references to the tokens module
adoption       = tokenUsages / (tokenUsages + colorLiterals + sizeLiterals)
```

Approximate is fine; report the numbers you used. Also check `classname` hits vs `stylesheet-create` hits
to confirm the styling policy is actually followed.

| Adoption | Hardcoded hex in components | Score impact |
|---|---|---|
| ≥ 95% | 0–2 (each justified) | supports 9–10 |
| 85–95% | ≤ 10 | supports 7–8 |
| 70–85% | ≤ 30 | caps at 6 |
| 50–70% | many | caps at 4 |
| < 50% or no token file | — | caps at 2 |

Also lower the score when: dark/light variable sets differ (P2 per missing variable group, P1 if a theme
renders unreadable text), or a design doc lists tokens that `global.css` doesn't define.

## 7. False positives

- Hex in `global.css`, theme/token modules, generated color constants, SVG asset components, tests, stories.
- `arbitrary-tw-value` for media sizes (`w-[120px]` thumbnails), hairlines (`h-[0.5px]`), safe-area math.
- `rgba(` inside the alpha/flatten helper itself.
- `fontSize` inside a chart/graph library config object that cannot take classes — still prefer a token constant.
