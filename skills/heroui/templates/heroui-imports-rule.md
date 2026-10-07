---
description: HeroUI Native granular import policy — never import from the "heroui-native" root in app, component or library files
paths:
  - "app/**/*.tsx"
  - "src/**/*.tsx"
  - "components/**/*.tsx"
  - "features/**/*.tsx"
  - "lib/**/*.{ts,tsx}"
  - "hooks/**/*.{ts,tsx}"
---

Import HeroUI Native per component, never from the package root:

- Components: `from "heroui-native/button"`, `"heroui-native/card"`, `"heroui-native/bottom-sheet"`,
  `"heroui-native/skeleton"`, `"heroui-native/pressable-feedback"`, `"heroui-native/spinner"`,
  `"heroui-native/dialog"`, `"heroui-native/text-field"`, … (one entry per component folder name, kebab-case).
- Utilities: `cn` / `colorKit` from `"heroui-native/utils"`; `useThemeColor`, `useBottomSheetAwareHandlers`
  from `"heroui-native/hooks"`; portal from `"heroui-native/portal"`.
- Provider: `HeroUINativeProvider` from `"heroui-native/provider"` (or `"heroui-native/provider-raw"` without
  Toast/PortalHost).

Banned: `from "heroui-native"` anywhere in these paths. A single root import pulls every component into the
bundle and defeats the per-component entry points.

Only exception: the root layout may import `HeroUINativeProvider` from the root while migrating; prefer
`"heroui-native/provider"`. `import type { … } from "heroui-native"` is harmless but normalize it too.

The library's own docs and examples show root imports — translate them to granular paths when copying.
When editing a file with mixed styles, normalize every HeroUI import in that file to granular.
