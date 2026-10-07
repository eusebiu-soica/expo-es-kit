# Bundle checks (category `bundle`)
Scope: JS bundle weight and composition, dead/dev-only code in production, static asset weight.

Check ids (`BUN-Cnn`) are stable references for this file; findings get report ids `BUN-001…`.

**Read-only rule:** do not run `npx expo export` or any analyzer unless the user explicitly asks — export writes `dist/` (and Atlas writes `.expo/atlas.jsonl`). Default to static analysis of imports and `package.json`.

## Signals to start from

| Scan path | Meaning |
|---|---|
| `hits["moment-import"]`, `stack.libs.moment` | moment (+ locales), maintenance mode. |
| `hits["lodash-full"]`, `stack.libs.lodash` | Whole lodash imported. `lodash-es` with named imports is fine-ish (tree-shaking in Metro is limited — check). |
| `hits["crypto-js"]`, `stack.libs["crypto-js"]` | Heavy pure-JS crypto; `expo-crypto`/native alternatives exist. |
| `hits["aws-sdk-v2"]` | Monolithic AWS SDK v2. |
| `hits["firebase-compat"]` | Firebase compat layer (larger than modular API). |
| `hits["barrel-import-icons"]` | `@expo/vector-icons` / `react-native-vector-icons` root import. |
| `hits["heroui-root-import"]` | UI library root import instead of granular paths. |
| `hits["dev-only-import"]` | faker, reactotron, why-did-you-render, flipper in client code. |
| `hits["require-dynamic"]` | `require(variable)` — Metro bundles every candidate or fails; check intent. |
| `hits["console-log"]`, `config.babel.removeConsole` | Stray logs and whether they are stripped in production. |
| `config.metro` | `inlineRequires`, custom config. |
| `stack.libs` | Look for: `date-fns` (fine with per-function imports), `dayjs`, `axios` vs `fetch`, multiple state libs, multiple animation libs, `lottie-react-native` + Skia + Reanimated overlap. |
| `config.scripts` | Existing analyze/size scripts. |

Also read `package.json` dependencies directly (scan only lists known libs) and list `assets/` sizes: `find assets -type f -size +300k -exec ls -lh {} \;`.

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| BUN-C01 | No moment | `hits["moment-import"]`. | P1 | `date-fns` (per-function imports), `dayjs`, or `Intl.DateTimeFormat`/`Intl.RelativeTimeFormat`. |
| BUN-C02 | No whole lodash | `hits["lodash-full"]`, `import _ from 'lodash'`. | P2 | `import debounce from 'lodash/debounce'` or native (`structuredClone`, `Object.groupBy`, `Array.prototype.toSorted`). |
| BUN-C03 | No heavy legacy SDKs | `aws-sdk` v2, `firebase/compat`, `crypto-js`. | P1 (aws-sdk v2); P2 others | AWS SDK v3 modular clients (or server-side presigned URLs); Firebase modular API; `expo-crypto` / native crypto. |
| BUN-C04 | Icon imports granular | `hits["barrel-import-icons"]`; count distinct icon families. | P2 | `import Ionicons from '@expo/vector-icons/Ionicons'`; one icon family; or SVG icons via `react-native-svg` components imported individually. |
| BUN-C05 | UI library granular imports | `hits["heroui-root-import"]`, other UI libs' root imports (`from 'heroui-native'`, design-system barrels). | P2 | Per-component entry points (`heroui-native/button`). |
| BUN-C06 | Internal barrels not pulling everything | `index.ts` re-exporting entire feature folders imported by root layout/providers. | P2 | Import from the concrete module in hot paths; keep barrels thin. |
| BUN-C07 | No dev-only libs in prod code | `hits["dev-only-import"]`; also `devDependencies` imported from app code (`import` of a devDependency in `app/`, `components/`, `lib/`). | P1 if bundled in release (faker is huge); P2 if guarded by `__DEV__` require | Move to dev-only entry (`if (__DEV__) require('./devtools')`), or delete. |
| BUN-C08 | Console stripped in production | `config.babel.removeConsole` false and `hits["console-log"]` > 0. | P2 | `babel-plugin-transform-remove-console` in production env (keep `error`/`warn` if crash reporting uses breadcrumbs). |
| BUN-C09 | Unused dependencies | `npx depcheck` or `npx knip` (read-only) — or grep each dependency name in source. | P2 (P1 if unused native modules add binary size/permissions) | Remove; native deps need a rebuild. |
| BUN-C10 | Duplicate-purpose libraries | Two date libs, two HTTP clients, two state managers, two animation stacks, two icon families. | P2 | Standardize on one; migrate stragglers. |
| BUN-C11 | Large static assets | PNG/JPG > 300 KB in `assets/`, uncompressed onboarding images, multiple @2x/@3x of huge images, large Lottie JSON. | P2 (P1 if total assets > ~20 MB) | Convert to WebP/AVIF, resize to max displayed size, compress Lottie or replace with Reanimated. |
| BUN-C12 | Asset bundling scoped | `assetBundlePatterns` (if present) bundling `**/*` including unused/raw assets; fonts/images unused by code. | P2 | Narrow patterns; delete unused assets. |
| BUN-C13 | Dynamic require intended | `hits["require-dynamic"]` in app code. | P2 | Static map: `const IMAGES = { a: require('./a.png') }`. |
| BUN-C14 | Polyfills necessary | `react-native-get-random-values`, `react-native-url-polyfill`, `buffer`, `text-encoding` — still needed on current Hermes/SDK? | P2 | Remove polyfills the runtime now provides; keep those required by a specific lib (document why). |
| BUN-C15 | JSON/data blobs not in bundle | Large `.json` fixtures, translations for all locales, mock data imported by app code. | P2 (P1 if > 1 MB) | Load per-locale lazily; move data to server/assets; mocks only in tests/dev. |
| BUN-C16 | Server code not bundled | Imports from `server/`, `supabase/functions/`, `+api` helpers or Node-only libs (`fs`, `crypto` Node) in client modules. | P1 if it bundles secrets or breaks; P2 otherwise | Separate client/server modules; shared code only types and pure utilities. |
| BUN-C17 | Bundle analyzed at least once | Any record of Atlas/source-map analysis, size budget, or CI size check. | P2 if absent (blocks score > 8) | Run Expo Atlas on request; record the top 10 modules and total size in `docs/audits/`. |
| BUN-C18 | Hermes bytecode | `config.jsEngine` is Hermes (bytecode precompiled → faster parse, smaller effective cost). | P1 if `jsc` | Use Hermes (default). |

## Proven patterns

**Analyze (only on explicit request — writes `dist/` / `.expo/`)**
```sh
# Expo Atlas (SDK 51+)
EXPO_ATLAS=true npx expo export --platform android
npx expo-atlas .expo/atlas.jsonl

# Or during dev, production-like transform
EXPO_ATLAS=true npx expo start --no-dev      # open Atlas from the dev tools plugin menu

# source-map-explorer (older SDKs)
npx expo export --source-maps --platform ios --no-bytecode
npx source-map-explorer dist/_expo/static/js/ios/*.js dist/_expo/static/js/ios/*.map
```
Read the top modules by size; flag anything > 100 KB that is not core (react-native, react, expo-router, reanimated).

**Granular imports**
```ts
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import debounce from 'lodash/debounce';
import { Button } from 'heroui-native/button';
```

**Strip console in production (babel.config.js)**
```js
module.exports = (api) => {
  api.cache(true);
  const plugins = [];
  if (process.env.NODE_ENV === 'production') plugins.push(['transform-remove-console', { exclude: ['error', 'warn'] }]);
  plugins.push('react-native-worklets/plugin');     // still last
  return { presets: ['babel-preset-expo'], plugins };
};
```

**Dev-only tooling**
```ts
if (__DEV__) {
  require('./devtools/reactotron');
}
```

**Unused deps (read-only)**
```sh
npx depcheck --skip-missing
npx knip --dependencies
```

## Not a problem when

- `lodash-es` named imports in a lib that Metro tree-shakes adequately — verify bundle impact before flagging (P2 at most).
- `@expo/vector-icons` root import of a single family when only that family's font is used; still P2.
- `dev-only-import` inside `__DEV__`-guarded `require`, `scripts/`, tests, storybook.
- `crypto-js` used server-side only (API repo / Edge Function).
- `console-log` already guarded by `__DEV__` or a logger that no-ops in production.
- `require-dynamic` in config files (`app.config.ts`, `metro.config.js`, `babel.config.js`) — not bundled.
- Large assets that are app-store screenshots or design sources outside bundled folders.

## Score anchors

| Band | `bundle` looks like |
|---|---|
| 0–2 | Several heavy legacy libs (moment + aws-sdk v2 + full lodash), dev tooling and mock data shipped, tens of MB of raw assets, JSC. |
| 3–4 | One P1 heavy lib in hot path plus dev-only libs bundled; console not stripped; no idea of bundle composition. |
| 5–6 | No P1 libs, but barrels, duplicate-purpose libs, unused deps, oversized assets remain. |
| 7–8 | Granular imports, console stripped, assets compressed, no dev libs; never analyzed → max 8. |
| 9–10 | All of 7–8 plus analyzed with Atlas/source maps, size budget or CI check, regular unused-deps pruning. |
