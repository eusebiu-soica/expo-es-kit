# assets/ — agent rules

Bundled images, fonts, icons and SVG. Everything here ships in the binary or the OTA bundle.

## Use

- Photos: WebP (or AVIF where supported) at ~80% quality. UI art/icons with transparency: PNG or SVG.
- Size bundled bitmaps for their largest display size at @3x; provide `@2x`/`@3x` variants (`icon@2x.png`) instead of one oversized file.
- Keep any single bundled image under ~200KB; anything larger is a remote asset served through a CDN with `{{IMAGE_LIB}}` caching.
- App icon and splash: configured in `app.json` / `app.config.ts` (`icon`, `expo-splash-screen` plugin), source files 1024×1024 PNG without transparency for iOS icons.
- Fonts: embed at build time with the `expo-font` config plugin (`plugins: [['expo-font', { fonts: [...] }]]`), not `useFonts` at runtime. Ship only the weights you use (variable font or 2–3 static weights).
- SVG: `react-native-svg` + the SVG transformer for icons; simple icons can be an icon font/set with per-icon imports.
- Name files kebab-case, grouped by feature (`assets/images/onboarding/step-1.webp`).

## Never

- Commit unoptimized originals (multi-MB PNG/JPEG exports from design tools).
- Bundle images that are user content or change often; they belong on the server.
- Import a whole icon set barrel when you use five icons.
- Load fonts with `useFonts` on the startup path if the plugin can embed them (adds splash time).
- Inline large base64 data URIs in JS.
- Put licensed fonts/images in the repo without confirming the license allows app redistribution.

## Patterns

```ts
// app.config.ts
plugins: [
  ['expo-font', { fonts: ['./assets/fonts/Inter-Variable.ttf'] }],
  ['expo-splash-screen', { image: './assets/images/splash-icon.png', imageWidth: 200, backgroundColor: '#0B0B0F' }],
],
```

```tsx
import { Image } from 'expo-image';
<Image source={require('@/assets/images/onboarding/step-1.webp')} style={{ width: 240, height: 240 }} contentFit="contain" />
```

```bash
# optimize before committing (cwebp from libwebp; squoosh/sharp are fine too)
cwebp -q 80 in.png -o out.webp
```

## Before finishing

- [ ] New bitmaps are WebP/PNG at the right size and < ~200KB each.
- [ ] Fonts added via the `expo-font` plugin (dev client rebuilt).
- [ ] Unused assets removed.
- [ ] Icon/splash changes verified in a fresh native build, not Expo Go.
