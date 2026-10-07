// Shared rule set for scan.mjs (audit facts) and hooks/guard.mjs (real-time warnings).
// A hit is a *signal*, not a finding: auditors must read the code before turning it into a finding.
// `guard: true` rules also fire in the PostToolUse guard hook, with `message` shown to the agent.

const TSX = (c) => c.ext === ".tsx" || c.ext === ".jsx";
const notTest = (c) => !/(__tests__|\.test\.|\.spec\.|__mocks__|mocks?\/|\.stories\.)/.test(c.file);
const notServer = (c) => !/(\+api\.(t|j)sx?$|supabase\/functions\/|app\/api\/|server\/|scripts\/)/.test(c.file);
const clientCode = (c) => notTest(c) && notServer(c);
const SENSITIVE = /(token|session|auth|password|passwd|secret|jwt|refresh|credential|pin\b|otp)/i;

export const RULES = [
  // ---------- secure storage / secrets (client) ----------
  {
    id: "asyncstorage-sensitive", category: "secure-storage", severity: "P0", guard: true, scope: clientCode,
    re: /AsyncStorage\.(setItem|multiSet|mergeItem)\s*\(\s*[^,]*(token|session|auth|password|secret|jwt|refresh|credential)/i,
    message: "Sensitive value written to AsyncStorage (unencrypted). Store tokens/credentials with expo-secure-store (or MMKV encrypted with a SecureStore-held key for bulk data).",
  },
  {
    id: "mmkv-sensitive-key", category: "secure-storage", severity: "P1", guard: true, scope: clientCode,
    re: /\.(set|setString)\s*\(\s*['"`][^'"`]*(access.?token|refresh.?token|password|secret|jwt)[^'"`]*['"`]/i,
    not: /SecureStore/,
    message: "A credential appears to be written to a key-value store. Unless that MMKV instance is encrypted with a key from expo-secure-store, keep credentials in expo-secure-store only.",
  },
  {
    id: "service-role-in-client", category: "client-security", severity: "P0", guard: true, scope: clientCode,
    re: /service_role|SERVICE_ROLE|serviceRoleKey|SUPABASE_SERVICE/i,
    message: "Supabase service_role key referenced in app code. It bypasses RLS and anything in the bundle is public. Move this logic to a server (API route / Edge Function).",
  },
  {
    id: "expo-public-secret", category: "client-security", severity: "P0", guard: true,
    re: /EXPO_PUBLIC_\w*(SECRET|PRIVATE|SERVICE_ROLE|SERVICE_KEY|PASSWORD|ADMIN|SK_LIVE|SK_TEST|WEBHOOK|SIGNING|CLIENT_SECRET)\w*/i,
    message: "EXPO_PUBLIC_* variables are inlined into the JS bundle and readable by anyone. Never put secrets there; call a server endpoint that holds the secret.",
  },
  {
    id: "secret-literal", category: "client-security", severity: "P0", guard: true, scope: notTest,
    re: /(sk_live_[0-9a-zA-Z]{10,}|rk_live_[0-9a-zA-Z]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[0-9A-Za-z]{30,}|xox[abpr]-[0-9A-Za-z-]{10,}|sk-[A-Za-z0-9_-]{32,}|whsec_[0-9a-zA-Z]{10,}|sb_secret_[0-9A-Za-z_-]{10,})/,
    message: "Hard-coded secret detected. Remove it, rotate it, and load it server-side from an environment variable.",
  },
  {
    id: "jwt-literal", category: "client-security", severity: "P1", scope: notTest,
    re: /['"`]eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}['"`]/,
  },
  {
    id: "log-sensitive", category: "client-security", severity: "P1", guard: true, scope: notTest,
    re: /console\.(log|info|debug|warn|error)\s*\([^)]*\b(access_?token|refresh_?token|session|password|jwt|secret|authorization)\b/i,
    message: "Logging what looks like a token/session/password. Logs end up in device logs and crash reporters; log an id or a boolean instead.",
  },
  {
    id: "console-log", category: "client-security", severity: "P2", scope: clientCode,
    re: /console\.(log|debug|info)\s*\(/,
    not: /__DEV__/,
  },
  {
    id: "http-cleartext", category: "client-security", severity: "P1", guard: true, scope: notTest,
    re: /['"`]http:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0|192\.168\.|10\.\d|schemas\.|www\.w3\.org|\$\{)/,
    message: "Cleartext http:// endpoint. Use https:// (iOS ATS and Android block cleartext by default; it also exposes tokens on the network).",
  },
  { id: "eval-usage", category: "client-security", severity: "P1", scope: notTest, re: /\beval\s*\(|new Function\s*\(/ },
  { id: "webview-usage", category: "client-security", severity: "P2", re: /<WebView\b/ },
  { id: "webview-risky", category: "client-security", severity: "P1", re: /originWhitelist=\{\[\s*['"]\*['"]\s*\]\}|allowUniversalAccessFromFileURLs|mixedContentMode=['"]always['"]|injectedJavaScript(BeforeContentLoaded)?=/ },
  { id: "deeplink-handler", category: "client-security", severity: "P2", re: /Linking\.(addEventListener|getInitialURL)|useURL\s*\(|useLinkingURL|Linking\.parse\(/ },
  { id: "math-random-token", category: "client-security", severity: "P1", re: /Math\.random\(\)[^;\n]*(token|nonce|secret|password|otp|code_verifier|state)/i },
  { id: "dangerously-set-html", category: "client-security", severity: "P2", re: /dangerouslySetInnerHTML/ },

  // ---------- auth & sessions ----------
  { id: "supabase-create-client", category: "auth-sessions", re: /createClient\s*(<[^>]*>)?\s*\(/, scope: (c) => /supabase/i.test(c.text) },
  { id: "supabase-storage-adapter", category: "auth-sessions", re: /storage\s*:\s*\w+/, scope: (c) => /createClient/.test(c.text) && /supabase/i.test(c.text) },
  { id: "supabase-auto-refresh", category: "auth-sessions", re: /startAutoRefresh|stopAutoRefresh|autoRefreshToken/ },
  { id: "supabase-pkce", category: "auth-sessions", re: /flowType\s*:\s*['"]pkce['"]|exchangeCodeForSession/ },
  { id: "supabase-get-session", category: "auth-sessions", re: /auth\.getSession\s*\(/ },
  { id: "supabase-get-user", category: "auth-sessions", re: /auth\.(getUser|getClaims)\s*\(/ },
  { id: "sign-out", category: "auth-sessions", re: /signOut\s*\(|logout\s*\(|logOut\s*\(/ },
  { id: "query-cache-clear", category: "auth-sessions", re: /queryClient\.(clear|removeQueries|resetQueries)\s*\(/ },
  { id: "image-cache-clear", category: "auth-sessions", re: /Image\.(clearDiskCache|clearMemoryCache)\s*\(/ },
  { id: "storage-clear-all", category: "auth-sessions", re: /\.clearAll\s*\(|AsyncStorage\.clear\s*\(|\.clearStore|deleteItemAsync\s*\(/ },
  { id: "auth-session-lib", category: "auth-sessions", re: /expo-auth-session|AuthSession\.|makeRedirectUri|WebBrowser\.openAuthSessionAsync/ },
  { id: "biometric", category: "auth-sessions", re: /expo-local-authentication|authenticateAsync\s*\(/ },
  { id: "account-deletion", category: "release", re: /delete[_\s-]?account|deleteAccount|account[_\s-]?deletion|deleteUser/i },
  { id: "token-in-url", category: "auth-sessions", severity: "P1", guard: true, scope: notTest,
    re: /[?&](access_token|refresh_token|token|session|jwt)=\$\{/i,
    message: "Token placed in a URL query string. URLs leak into logs, analytics, referrers and image caches; send tokens in the Authorization header instead." },
  { id: "jwt-decode-only", category: "auth-sessions", severity: "P1", re: /jwt-decode|jwtDecode\s*\(|decodeJwt\s*\(/ },

  // ---------- MMKV / storage ----------
  { id: "asyncstorage-import", category: "mmkv", re: /from\s+['"]@react-native-async-storage\/async-storage['"]/ },
  { id: "asyncstorage-call", category: "mmkv", re: /AsyncStorage\.(getItem|setItem|multiGet|multiSet|getAllKeys)\s*\(/ },
  { id: "mmkv-instance", category: "mmkv", re: /new MMKV\s*\(|createMMKV\s*\(/ },
  { id: "mmkv-encryption", category: "mmkv", re: /encryptionKey\s*:|\.recrypt\s*\(/ },
  { id: "mmkv-hooks", category: "mmkv", re: /useMMKV(String|Number|Boolean|Object|Listener)?\s*\(/ },
  { id: "securestore-call", category: "secure-storage", re: /SecureStore\.(setItemAsync|getItemAsync|deleteItemAsync|setItem|getItem)\s*\(/ },
  { id: "securestore-options", category: "secure-storage", re: /keychainAccessible|requireAuthentication|WHEN_UNLOCKED|AFTER_FIRST_UNLOCK/ },
  { id: "sqlite-usage", category: "mmkv", re: /expo-sqlite|openDatabaseAsync|openDatabaseSync/ },

  // ---------- caching ----------
  { id: "query-client", category: "caching", re: /new QueryClient\s*\(/ },
  { id: "query-stale-time", category: "caching", re: /staleTime\s*:/ },
  { id: "query-gc-time", category: "caching", re: /gcTime\s*:|cacheTime\s*:/ },
  { id: "query-persist-whole", category: "caching", severity: "P2", guard: true,
    re: /persistQueryClient\s*\(|PersistQueryClientProvider|createAsyncStoragePersister|createSyncStoragePersister/,
    message: "Whole-cache persistence restores the entire query cache at startup and grows over time. Prefer per-query-family snapshots with TTL + shape validation, and keep high-churn families memory-only." },
  { id: "query-focus-manager", category: "caching", re: /focusManager\.(setEventListener|setFocused)|onlineManager\.setEventListener/ },
  { id: "query-invalidate-all", category: "caching", severity: "P2", re: /invalidateQueries\s*\(\s*\)/ },
  { id: "use-query", category: "caching", re: /\buse(Suspense)?(Infinite)?Query\s*\(/ },
  { id: "fetch-in-effect", category: "caching", severity: "P2", re: /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*\bfetch\s*\(/ },

  // ---------- performance: images ----------
  { id: "rn-image-import", category: "perf", severity: "P2", guard: true, scope: TSX,
    re: /import\s*\{[^}]*\bImage\b[^}]*\}\s*from\s*['"]react-native['"]/,
    message: "Image from react-native has no disk cache or recycling. For remote images use expo-image with cachePolicy=\"memory-disk\" and recyclingKey in lists." },
  { id: "expo-image-import", category: "perf", re: /from\s+['"]expo-image['"]/ },
  { id: "expo-image-cache-policy", category: "perf", re: /cachePolicy\s*=/ },
  { id: "expo-image-recycling", category: "perf", re: /recyclingKey\s*=/ },
  { id: "fast-image", category: "perf", severity: "P2", re: /react-native-fast-image/ },

  // ---------- performance: lists & render ----------
  { id: "flatlist", category: "perf", re: /<FlatList\b|<Animated\.FlatList\b/ },
  { id: "sectionlist", category: "perf", re: /<SectionList\b/ },
  { id: "flashlist", category: "perf", re: /<FlashList\b/ },
  { id: "legendlist", category: "perf", re: /<LegendList\b/ },
  { id: "scrollview", category: "perf", re: /<ScrollView\b|<Animated\.ScrollView\b|<KeyboardAwareScrollView\b/ },
  { id: "inline-style", category: "perf", severity: "P2", scope: TSX, re: /style=\{\{/ },
  { id: "inline-handler", category: "perf", severity: "P2", scope: TSX, re: /\bon[A-Z]\w*=\{\s*(async\s*)?\(/ },
  { id: "stylesheet-create", category: "perf", re: /StyleSheet\.create\s*\(/ },
  { id: "memo", category: "perf", re: /\bmemo\s*\(|React\.memo\s*\(/ },
  { id: "use-callback", category: "perf", re: /useCallback\s*\(/ },
  { id: "use-memo", category: "perf", re: /useMemo\s*\(/ },
  { id: "use-ref-eager", category: "perf", severity: "P2", re: /useRef\s*\(\s*new\s+\w+|useRef\s*\(\s*\w+\.(map|filter|reduce)\(|useRef\s*\(\s*create\w*\(/ },
  { id: "find-in-loop", category: "perf", severity: "P2", re: /\.(map|forEach|filter|reduce)\s*\([^)]*=>[^;\n]*\.(find|findIndex|filter|includes|indexOf)\s*\(/ },
  { id: "json-parse-render", category: "perf", severity: "P2", scope: TSX, re: /JSON\.parse\s*\(/ },
  { id: "remove-clipped", category: "perf", re: /removeClippedSubviews/ },
  { id: "get-item-layout", category: "perf", re: /getItemLayout\s*=|estimatedItemSize|getEstimatedItemSize/ },
  { id: "key-index", category: "perf", severity: "P2", scope: TSX, re: /key=\{\s*(index|i|idx)\s*\}|keyExtractor=\{\s*\([^)]*,\s*(index|i)\s*\)\s*=>\s*(String\()?\s*(index|i)\b/ },
  { id: "interaction-manager", category: "perf", re: /InteractionManager\.runAfterInteractions/ },
  { id: "deferred-value", category: "perf", re: /useDeferredValue|startTransition|useTransition/ },
  { id: "freeze-on-blur", category: "perf", re: /freezeOnBlur/ },
  { id: "lazy-screen", category: "startup", re: /React\.lazy\s*\(|\blazy\s*\(\s*\(\)\s*=>\s*import|import\s*\(\s*['"]/ },
  { id: "reanimated-usage", category: "perf", re: /useAnimatedStyle|useSharedValue|withTiming|withSpring/ },
  { id: "animated-layout-prop", category: "perf", severity: "P2", re: /withTiming\s*\(|withSpring\s*\(/, scope: (c) => /useAnimatedStyle[\s\S]{0,400}\b(width|height|top|left|margin|padding)\s*:/.test(c.text) },
  { id: "run-on-js", category: "perf", re: /runOnJS\s*\(|scheduleOnRN\s*\(/ },
  { id: "old-animated", category: "perf", severity: "P2", re: /Animated\.(timing|spring|Value)\b/, not: /useNativeDriver\s*:\s*true/ },
  { id: "use-native-driver-false", category: "perf", severity: "P2", re: /useNativeDriver\s*:\s*false/ },
  { id: "reduced-motion", category: "perf", re: /useReducedMotion|ReduceMotion|isReduceMotionEnabled/ },
  { id: "promise-all", category: "perf", re: /Promise\.all(Settled)?\s*\(/ },
  { id: "perf-log-not-dev", category: "perf", severity: "P2", re: /performance\.now\(\)|Profiler\b|onRender=/, not: /__DEV__/ },
  { id: "with-alpha", category: "perf", re: /withAlpha\s*\(|rgba\s*\(|\b(bg|text|border)-[\w-]+\/\d{1,3}\b/, scope: TSX },

  // ---------- startup ----------
  { id: "splash-prevent", category: "startup", re: /SplashScreen\.preventAutoHideAsync/ },
  { id: "splash-hide", category: "startup", re: /SplashScreen\.(hideAsync|hide)\s*\(/ },
  { id: "use-fonts", category: "startup", re: /useFonts\s*\(|Font\.loadAsync/ },
  { id: "top-level-await-storage", category: "startup", severity: "P2", re: /^(const|let)\s+\w+\s*=\s*await\s+(AsyncStorage|SecureStore)/ },
  { id: "sentry-init", category: "release", re: /Sentry\.init\s*\(|initCrashReporting|Bugsnag\.start|crashlytics\(\)/ },
  { id: "error-boundary", category: "release", re: /ErrorBoundary|componentDidCatch|export\s+function\s+ErrorBoundary/ },

  // ---------- bundle ----------
  { id: "moment-import", category: "bundle", severity: "P1", guard: true, re: /from\s+['"]moment(-timezone)?['"]|require\(['"]moment['"]\)/,
    message: "moment adds ~70KB+ min (more with locales) and is in maintenance mode. Use date-fns (per-function imports), dayjs, or Intl." },
  { id: "lodash-full", category: "bundle", severity: "P2", guard: true, re: /from\s+['"]lodash['"]|require\(['"]lodash['"]\)|import\s+_\s+from\s+['"]lodash/,
    message: "Importing the whole lodash package. Import per-method (lodash/debounce) or use native JS." },
  { id: "barrel-import-icons", category: "bundle", severity: "P2", re: /from\s+['"](react-native-vector-icons|@expo\/vector-icons)['"]/ },
  { id: "crypto-js", category: "bundle", severity: "P2", re: /from\s+['"]crypto-js['"]/ },
  { id: "firebase-compat", category: "bundle", severity: "P2", re: /firebase\/compat/ },
  { id: "aws-sdk-v2", category: "bundle", severity: "P1", re: /from\s+['"]aws-sdk['"]/ },
  { id: "require-dynamic", category: "bundle", re: /require\s*\(\s*[^'"`)\s]/ },
  { id: "dev-only-import", category: "bundle", severity: "P2", re: /from\s+['"](@faker-js\/faker|faker|why-did-you-render|reactotron[\w-]*|flipper[\w-]*)['"]/, scope: clientCode },

  // ---------- backend access ----------
  { id: "supabase-table-access", category: "backend", re: /\.from\s*\(\s*['"`]\w+['"`]\s*\)\s*\.?\s*(select|insert|update|delete|upsert)?/, scope: (c) => /supabase/i.test(c.text) },
  { id: "supabase-rpc", category: "backend", re: /\.rpc\s*\(\s*['"`]\w+/ },
  { id: "supabase-storage", category: "backend", re: /\.storage\s*\.from\s*\(/ },
  { id: "supabase-signed-url", category: "caching", re: /createSignedUrls?\s*\(/ },
  { id: "supabase-realtime", category: "backend", re: /\.channel\s*\(|postgres_changes/ },
  { id: "firebase-firestore", category: "backend", re: /firestore\(\)|getFirestore\s*\(|collection\s*\(\s*db/ },
  { id: "api-fetch", category: "backend", re: /fetch\s*\(\s*(`\$\{[^}]*(API|BASE)[^}]*\}|[`'"][^`'"]*\/api\/)/i },
  { id: "api-client", category: "backend", re: /axios\.create\s*\(|ky\.create\s*\(|createApiClient|apiClient\.(get|post|put|patch|delete)|openapi-fetch|createClient<paths>/ },
  { id: "auth-header", category: "auth-sessions", re: /Authorization['"]?\s*[:=]\s*[`'"]Bearer/ },
  { id: "refresh-on-401", category: "auth-sessions", re: /\b401\b/ },
  { id: "abort-timeout", category: "backend", re: /AbortController|AbortSignal\.timeout|signal\s*:/ },

  // ---------- heroui ----------
  { id: "heroui-root-import", category: "heroui", severity: "P2", guard: true, re: /from\s+['"]heroui-native['"]/, not: /HeroUINativeProvider/,
    message: "Root import from \"heroui-native\" pulls the whole library into this module. Import granularly: from \"heroui-native/button\", \"heroui-native/card\", etc." },
  { id: "heroui-import", category: "heroui", re: /from\s+['"]heroui-native(\/[\w-]+)?['"]/ },
  { id: "heroui-bottom-sheet", category: "heroui", re: /BottomSheet\b/, scope: (c) => /heroui-native/.test(c.text) },
  { id: "heroui-skeleton", category: "heroui", re: /<Skeleton\b/ },
  { id: "raw-pressable", category: "heroui", severity: "P2", re: /<Pressable\b|<TouchableOpacity\b|<TouchableHighlight\b/, scope: TSX },
  { id: "hardcoded-hex", category: "heroui", severity: "P2", scope: TSX, re: /['"`]#[0-9a-fA-F]{3,8}['"`]|\b(bg|text|border|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/ },
  { id: "arbitrary-tw-value", category: "heroui", severity: "P2", scope: TSX, re: /\b(text|p[xytrbl]?|m[xytrbl]?|gap|rounded|w|h|leading|tracking)-\[\d/ },
  { id: "font-size-literal", category: "heroui", severity: "P2", scope: TSX, re: /fontSize\s*:\s*\d/ },
  { id: "classname", category: "heroui", scope: TSX, re: /className=/ },
  { id: "tv-variants", category: "heroui", re: /\btv\s*\(\s*\{/ },
  { id: "a11y-label", category: "heroui", re: /accessibilityLabel=|aria-label=|accessibilityRole=|role=/ },
  { id: "icon-only-button", category: "heroui", re: /isIconOnly/ },

  // ---------- quality ----------
  { id: "ts-ignore", category: "release", severity: "P2", re: /@ts-ignore|@ts-nocheck/ },
  { id: "any-type", category: "release", severity: "P2", re: /:\s*any\b|as any\b/ },
  { id: "eslint-disable", category: "release", severity: "P2", re: /eslint-disable/ },
  { id: "todo-fixme", category: "release", severity: "P2", re: /\b(TODO|FIXME|HACK|XXX)\b/ },
];

// File-level rules: test the whole file once, return true / {line, text} / false.
export const FILE_RULES = [
  {
    id: "flatlist-no-keyextractor", category: "perf",
    test: (c) => /<FlatList\b/.test(c.text) && !/keyExtractor/.test(c.text),
  },
  {
    id: "scrollview-map", category: "perf",
    scope: TSX,
    test: (c) => {
      if (!/<(Animated\.)?ScrollView\b/.test(c.text)) return false;
      const m = c.text.match(/\.map\s*\(\s*\(?[^)]*\)?\s*=>\s*\(?\s*</);
      if (!m) return false;
      const line = c.text.slice(0, m.index).split("\n").length;
      return { line, text: "ScrollView renders a .map() of JSX — unbounded content is not virtualized" };
    },
  },
  {
    id: "expo-image-no-cache-policy", category: "perf",
    test: (c) => /from\s+['"]expo-image['"]/.test(c.text) && /<Image\b/.test(c.text) && !/cachePolicy/.test(c.text),
  },
  {
    id: "list-item-not-memo", category: "perf",
    scope: TSX,
    test: (c) => /renderItem=\{\s*\(\s*\{\s*item/.test(c.text) && !/memo\s*\(/.test(c.text),
  },
  {
    id: "context-value-inline", category: "perf",
    scope: TSX,
    test: (c) => {
      const m = c.text.match(/<\w+\.Provider\s+value=\{\{/);
      if (!m) return false;
      return { line: c.text.slice(0, m.index).split("\n").length, text: "Context Provider value is an inline object — every render re-renders all consumers" };
    },
  },
  {
    id: "supabase-client-no-secure-storage", category: "auth-sessions",
    test: (c) => {
      if (!/createClient\s*(<[^>]*>)?\s*\(/.test(c.text) || !/supabase/i.test(c.text)) return false;
      if (/SecureStore|secure-?store|secureStorage|LargeSecureStore|mmkv/i.test(c.text)) return false;
      return { line: 1, text: "Supabase client created without a SecureStore/encrypted storage adapter (check the storage option)" };
    },
  },
  {
    id: "large-component", category: "perf",
    scope: TSX,
    test: (c) => {
      const n = c.text.split("\n").length;
      return n > 600 ? { line: 1, text: `${n} lines — check render cost, not just length` } : false;
    },
  },
];

// Redact anything that looks like a secret before it goes into scan output.
export function redact(s) {
  return s
    .replace(/(sk_live_|rk_live_|sk_test_|whsec_|sb_secret_|ghp_|xox[abpr]-|sk-)[0-9A-Za-z_-]{6,}/g, "$1•••")
    .replace(/AKIA[0-9A-Z]{12,}/g, "AKIA•••")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "eyJ•••(jwt)")
    .replace(/(['"`])[A-Za-z0-9+/_-]{40,}\1/g, "$1•••(long literal)$1");
}

export const GUARD_RULES = RULES.filter((r) => r.guard);
