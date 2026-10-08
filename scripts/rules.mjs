// Shared rule set for scan.mjs (audit facts) and hooks/guard.mjs (real-time warnings).
// A hit is a *signal*, not a finding: auditors must read the code before turning it into a finding.
// `guard: true` rules also fire in the PostToolUse guard hook, with `message` shown to the agent.

const TSX = (c) => c.ext === ".tsx" || c.ext === ".jsx";
const notTest = (c) => !/(__tests__|\.test\.|\.spec\.|__mocks__|mocks?\/|\.stories\.|(^|\/)e2e\/|(^|\/)test-[^/]*$)/.test(c.file);
// Dev tooling that never ships (local scripts, seeds, config files).
const notTooling = (c) => notTest(c) && !/((^|\/)(scripts|tools|seeds?|fixtures)\/|\.config\.(t|j|mj|cj)s$)/.test(c.file);
const notServer = (c) => !/(\+api\.(t|j)sx?$|supabase\/functions\/|app\/api\/|pages\/api\/|server\/|scripts\/)/.test(c.file);
// `c.server` is set by security-scan.mjs (true for every file of a separate API repo); otherwise the path decides.
const isServer = (c) => c.server ?? !notServer(c);
const clientCode = (c) => notTest(c) && !isServer(c);
const serverCode = (c) => notTooling(c) && isServer(c);
const SENSITIVE = /(token|session|auth|password|passwd|secret|jwt|refresh|credential|pin\b|otp)/i;
// Query-string names that must never carry user data (URLs end up in logs, analytics, referrers, history).
const PII_PARAM = "password|passwd|pwd|pass|email|e_?mail|phone|phone_?number|cnp|ssn|iban|card|card_?number|cvv|otp|pin|secret|api_?key|apikey|private_?key";
// Values that come from the request in a server handler.
const REQ = "(?:req|request|body|params|query|searchParams|input|payload|ctx\\.params|event\\.body)";

export const RULES = [
  // ---------- secure storage / secrets (client) ----------
  {
    id: "asyncstorage-sensitive", category: "secure-storage", area: "secrets", severity: "P0", guard: true, scope: clientCode,
    re: /AsyncStorage\.(setItem|multiSet|mergeItem)\s*\(\s*[^,]*(token|session|auth|password|secret|jwt|refresh|credential)/i,
    message: "Sensitive value written to AsyncStorage (unencrypted). Store tokens/credentials with expo-secure-store (or MMKV encrypted with a SecureStore-held key for bulk data).",
  },
  {
    id: "mmkv-sensitive-key", category: "secure-storage", area: "secrets", severity: "P1", guard: true, scope: clientCode,
    re: /\.(set|setString)\s*\(\s*['"`][^'"`]*(access.?token|refresh.?token|password|secret|jwt)[^'"`]*['"`]/i,
    not: /SecureStore/,
    message: "A credential appears to be written to a key-value store. Unless that MMKV instance is encrypted with a key from expo-secure-store, keep credentials in expo-secure-store only.",
  },
  {
    id: "service-role-in-client", category: "client-security", area: "secrets", severity: "P0", guard: true, scope: clientCode,
    re: /service_role|SERVICE_ROLE|serviceRoleKey|SUPABASE_SERVICE/i,
    message: "Supabase service_role key referenced in app code. It bypasses RLS and anything in the bundle is public. Move this logic to a server (API route / Edge Function).",
  },
  {
    id: "expo-public-secret", category: "client-security", area: "secrets", severity: "P0", guard: true,
    re: /EXPO_PUBLIC_\w*(SECRET|PRIVATE|SERVICE_ROLE|SERVICE_KEY|PASSWORD|ADMIN|SK_LIVE|SK_TEST|WEBHOOK|SIGNING|CLIENT_SECRET)\w*/i,
    message: "EXPO_PUBLIC_* variables are inlined into the JS bundle and readable by anyone. Never put secrets there; call a server endpoint that holds the secret.",
  },
  {
    id: "secret-literal", category: "client-security", area: "secrets", severity: "P0", guard: true, scope: notTest,
    re: /(sk_live_[0-9a-zA-Z]{10,}|rk_live_[0-9a-zA-Z]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[0-9A-Za-z]{30,}|xox[abpr]-[0-9A-Za-z-]{10,}|sk-[A-Za-z0-9_-]{32,}|whsec_[0-9a-zA-Z]{10,}|sb_secret_[0-9A-Za-z_-]{10,})/,
    message: "Hard-coded secret detected. Remove it, rotate it, and load it server-side from an environment variable.",
  },
  {
    id: "jwt-literal", category: "client-security", area: "secrets", severity: "P1", scope: notTest,
    re: /['"`]eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}['"`]/,
  },
  {
    id: "log-sensitive", category: "client-security", area: "data-exposure", severity: "P1", guard: true, scope: notTest,
    re: /console\.(log|info|debug|warn|error)\s*\([^)]*\b(access_?token|refresh_?token|session|password|jwt|secret|authorization)\b/i,
    message: "Logging what looks like a token/session/password. Logs end up in device logs and crash reporters; log an id or a boolean instead.",
  },
  {
    id: "console-log", category: "client-security", area: "data-exposure", severity: "P2", scope: clientCode,
    re: /console\.(log|debug|info)\s*\(/,
    not: /__DEV__/,
  },
  {
    id: "http-cleartext", category: "client-security", area: "platform", severity: "P1", guard: true, scope: notTest,
    re: /['"`]http:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0|192\.168\.|10\.\d|schemas\.|www\.w3\.org|\$\{)/,
    message: "Cleartext http:// endpoint. Use https:// (iOS ATS and Android block cleartext by default; it also exposes tokens on the network).",
  },
  { id: "eval-usage", category: "client-security", area: "injection", severity: "P1", scope: notTest, re: /\beval\s*\(|new Function\s*\(/ },
  { id: "webview-usage", category: "client-security", area: "platform", severity: "P2", re: /<WebView\b/ },
  { id: "webview-risky", category: "client-security", area: "platform", severity: "P1", re: /originWhitelist=\{\[\s*['"]\*['"]\s*\]\}|allowUniversalAccessFromFileURLs|mixedContentMode=['"]always['"]|injectedJavaScript(BeforeContentLoaded)?=/ },
  { id: "deeplink-handler", category: "client-security", area: "url-exposure", severity: "P2", re: /Linking\.(addEventListener|getInitialURL)|useURL\s*\(|useLinkingURL|Linking\.parse\(/ },
  { id: "math-random-token", category: "client-security", area: "auth", severity: "P1", re: /Math\.random\(\)[^;\n]*(token|nonce|secret|password|otp|code_verifier|state)/i },
  { id: "dangerously-set-html", category: "client-security", area: "injection", severity: "P2", re: /dangerouslySetInnerHTML/ },

  // ---------- security: injection (used by the security skill; also feeds audit) ----------
  { id: "postgrest-filter-interpolation", category: "backend", area: "injection", severity: "P1", guard: true, scope: notTooling,
    re: /\.(or|filter|not)\s*\(\s*(`[^`]*\$\{|['"][^'"]*['"]\s*\+)/,
    message: "PostgREST filter string built from a variable (.or()/.filter() with ${} or +). User input can inject extra conditions (e.g. \",role.eq.admin\"). Use separate .eq()/.ilike() calls with the value as an argument, or allow-list/escape the value (commas, parentheses, quotes) before building the string." },
  { id: "postgrest-wildcard-interpolation", category: "backend", area: "injection", severity: "P2", scope: notTooling,
    re: /\.(ilike|like|textSearch)\s*\(\s*['"`][\w.]+['"`]\s*,\s*`[^`]*\$\{/, not: /escape|sanitize/i },
  { id: "raw-sql-interpolation", category: "backend", area: "injection", severity: "P1", guard: true, scope: notTooling,
    re: /(\.(query|execute|raw|unsafe)|sql\.raw|knex\.raw)\s*\(\s*(`[^`]*\$\{|['"`]\s*(select|insert|update|delete|with)\b[^'"`]*['"`]\s*\+)/i,
    message: "SQL built by string interpolation/concatenation. Pass values as bound parameters (pg: query(text, [values]); postgres.js / drizzle / Prisma: tagged templates sql`...${v}` are parameterized; knex: ? bindings). Never interpolate user input into SQL text." },
  { id: "prisma-raw-unsafe", category: "backend", area: "injection", severity: "P1", guard: true, scope: notTooling,
    re: /\$(queryRawUnsafe|executeRawUnsafe)\s*\(/,
    message: "$queryRawUnsafe/$executeRawUnsafe run a raw string. Use the tagged template $queryRaw`...${value}` (parameterized) or Prisma.sql, and never build the string from user input." },
  { id: "sqlite-interpolation", category: "client-security", area: "injection", severity: "P2", scope: notTest,
    re: /\.(execAsync|execSync|runAsync|runSync|getAllAsync|getAllSync|getFirstAsync|getFirstSync|executeSql|prepareAsync)\s*\(\s*`[^`]*\$\{/ },
  { id: "command-injection", category: "backend", area: "injection", severity: "P1", guard: true, scope: serverCode,
    re: /((?<![\w.])|\b(child_?[pP]rocess|cp)\.)(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(\s*`[^`]*\$\{|Deno\.(run|Command)\s*\([^)]*\$\{/,
    message: "Shell command built from interpolated values. Use execFile/spawn with an argument array (no shell), and validate/allow-list every argument." },
  { id: "ssrf-request-url", category: "backend", area: "injection", severity: "P1", scope: serverCode,
    re: new RegExp(`\\b(fetch|axios\\.(get|post|request)|got|ky)\\s*\\(\\s*(${REQ}[\\w.\\[\\]'"]*\\.(url|href|link|uri|endpoint|callback\\w*|webhook\\w*|image\\w*|src)\\b|searchParams\\.get\\(\\s*['"](url|href|link|uri|src|callback|webhook|image)['"]\\s*\\))`, "i") },
  { id: "path-traversal", category: "backend", area: "injection", severity: "P1", scope: serverCode,
    re: new RegExp(`\\b(readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|unlinkSync|sendFile|Deno\\.readFile|Deno\\.readTextFile)\\s*\\([^)]*\\b${REQ}\\b`) },
  { id: "regexp-from-input", category: "backend", area: "injection", severity: "P2", scope: notTooling,
    re: new RegExp(`new RegExp\\s*\\(\\s*(${REQ}\\b|(search|query|term|filter|q|text|value|keyword)\\s*([,)]|\\?\\?|\\|\\|))`) },
  { id: "webview-html-interpolation", category: "client-security", area: "injection", severity: "P1", scope: notTest,
    re: /source=\{\{\s*html\s*:\s*`[^`]*\$\{|injectJavaScript\s*\(\s*`[^`]*\$\{|injectedJavaScript(BeforeContentLoaded)?=\{\s*`[^`]*\$\{/ },
  { id: "inner-html", category: "client-security", area: "injection", severity: "P2", scope: notTest, re: /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(/ },

  // ---------- security: sensitive data in URLs / redirects ----------
  { id: "sensitive-param-in-url", category: "client-security", area: "url-exposure", severity: "P1", guard: true, scope: notTest,
    re: new RegExp(`[?&](${PII_PARAM})=(\\$\\{|['"\`]\\s*\\+)`, "i"),
    message: "Personal or secret data placed in a URL query string (password/email/phone/OTP/card…). URLs are stored in logs, analytics, browser/WebView history, referrers and push/deep links. Send it in the request body (POST) or keep it in app state instead." },
  { id: "route-params-sensitive", category: "client-security", area: "url-exposure", severity: "P1", scope: clientCode,
    re: new RegExp(`(router\\.(push|replace|navigate|setParams)|<Link\\b|href=\\{)\\s*\\(?\\s*\\{[^}]*params\\s*:\\s*\\{[^}]*\\b(${PII_PARAM}|token|access_token|refresh_token)\\b`, "i") },
  { id: "search-params-sensitive", category: "client-security", area: "url-exposure", severity: "P2", scope: notTest,
    re: new RegExp(`(\\{[^}]*\\b(${PII_PARAM}|token|access_token|refresh_token)\\b[^}]*\\}\\s*=\\s*use(Local|Global)SearchParams|searchParams\\.get\\(\\s*['"](${PII_PARAM}|access_token|refresh_token)['"]\\s*\\))`, "i") },
  { id: "open-redirect", category: "backend", area: "url-exposure", severity: "P1", scope: serverCode,
    re: /redirect\w*\s*\(\s*(new URL\(\s*)?(searchParams\.get\(\s*['"](next|redirect\w*|return\w*|callback\w*|continue|url|to)['"]\s*\)|(req|request)\.query\.(next|redirect\w*|return\w*|url|to)\b|(body|params|query)\.(next|redirect\w*|returnTo|returnUrl|url)\b)/i },
  { id: "client-redirect-param", category: "client-security", area: "url-exposure", severity: "P2", scope: clientCode,
    re: /(router\.(push|replace|navigate)|Linking\.openURL|WebBrowser\.openBrowserAsync)\s*\(\s*(params|searchParams|query|local)\??\.(next|redirect\w*|returnTo|returnUrl|url|to|callback\w*)\b/ },
  { id: "analytics-pii", category: "client-security", area: "data-exposure", severity: "P2", scope: notTest,
    re: /\b(track|logEvent|capture|identify|setUserProperties|setUserProperty|screen|setAttributes)\s*\([^)]*\b(email|phone|phoneNumber|password|address|cnp|ssn|iban|dateOfBirth|dob)\b/i },

  // ---------- security: access control ----------
  { id: "mass-assignment", category: "backend", area: "access-control", severity: "P1", scope: serverCode,
    re: /\.(insert|update|upsert)\s*\(\s*(body|req\.body|requestBody|await\s+(req|request)\.json\(\)|\{\s*\.\.\.(body|req\.body|requestBody)\b)|\.(create|update|upsert)\s*\(\s*\{\s*(where[^}]*\}\s*,\s*)?data\s*:\s*(body|req\.body|await\s+(req|request)\.json\(\)|\{\s*\.\.\.(body|req\.body)\b)/,
    not: /createHmac|createHash|crypto\.|hash\./ },

  // ---------- security: platform ----------
  { id: "clipboard-sensitive", category: "client-security", area: "platform", severity: "P2", scope: clientCode,
    re: /(Clipboard\.(setString|setStringAsync)|setStringAsync)\s*\([^)]*\b(token|password|secret|otp|key|seed|mnemonic|iban|recovery\w*)\b/i },

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
  { id: "token-in-url", category: "auth-sessions", area: "url-exposure", severity: "P1", guard: true, scope: notTest,
    re: /[?&](access_token|refresh_token|token|session|jwt)=(\$\{|['"`]\s*\+)/i,
    message: "Token placed in a URL query string. URLs leak into logs, analytics, referrers and image caches; send tokens in the Authorization header instead." },
  { id: "jwt-decode-only", category: "auth-sessions", area: "auth", severity: "P1", re: /jwt-decode|jwtDecode\s*\(|decodeJwt\s*\(/ },

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

  // ---------- security (file-level) ----------
  {
    // Route reads a record by an id that comes from the request, and nothing in the file scopes it to the caller.
    id: "id-access-without-owner-filter", category: "backend", area: "access-control", severity: "P1",
    scope: (c) => serverCode(c) && /(route|\+api|index|handler|controller|api\/)/i.test(c.file),
    test: (c) => {
      const m = c.text.match(/\.eq\(\s*['"]id['"]\s*,|findUnique\(\s*\{\s*where\s*:\s*\{\s*id\b|\.where\(\s*['"]?id['"]?\s*,|\.doc\(\s*(params|body|id)\b/);
      if (!m) return false;
      if (!/\b(params|body|searchParams|req|request|query|input)\b/.test(c.text)) return false;
      if (/\.eq\(\s*['"]\w+_id['"]|\.match\(\s*\{|(user_id|userId|owner_id|ownerId|created_by|createdBy|author_id|authorId|org_id|orgId|tenant_id|tenantId|team_id|teamId|workspace_id|member|auth\.uid|policy)\b|\b(assert|require|ensure|verify|check|can|authorize|has)\w*(Owner|Access|Member|Permission|Role|Admin|Tenant|Org)\w*\s*\(/.test(c.text)) return false;
      const line = c.text.slice(0, m.index).split("\n").length;
      const svc = /service_role|SERVICE_ROLE|serviceRole|supabaseAdmin|adminClient/i.test(c.text) ? " (service-role client: RLS does not apply)" : "";
      return { line, text: `Record looked up by id from the request with no owner/tenant check in this file${svc}` };
    },
  },
  {
    id: "password-input-not-secure", category: "client-security", area: "platform", severity: "P2",
    scope: (c) => TSX(c) && notTest(c) && !c.server && /from\s+['"](react-native|heroui-native[\w/-]*|react-native-paper|tamagui|@rneui\/[\w-]+)['"]/.test(c.text),
    test: (c) => {
      const re = /<(TextInput|TextField|Input|TextArea)\b(?:(?!<[A-Z])[\s\S]){0,800}?(placeholder|label|name|textContentType|autoComplete|accessibilityLabel)=\{?\s*['"`][^'"`]*(password|parol|passcode|\bpin\b)[^'"`]*['"`]/gi;
      for (const m of c.text.matchAll(re)) {
        const end = c.text.indexOf("/>", m.index);
        const tag = c.text.slice(m.index, end > 0 && end - m.index < 1500 ? end : m.index + 800);
        if (!/secureTextEntry|type=['"]password['"]/.test(tag)) {
          return { line: c.text.slice(0, m.index).split("\n").length, text: "Password-like input without secureTextEntry" };
        }
      }
      return false;
    },
  },
  {
    id: "webview-onmessage-no-origin", category: "client-security", area: "platform", severity: "P2", scope: notTest,
    test: (c) => {
      const m = c.text.match(/onMessage=\{/);
      if (!m || /nativeEvent\.(url|origin)|event\.origin|\.origin\s*(===|!==)|allowedOrigins|ALLOWED_ORIGINS/.test(c.text)) return false;
      return { line: c.text.slice(0, m.index).split("\n").length, text: "WebView onMessage handler with no origin/url check" };
    },
  },
  {
    id: "upload-no-validation", category: "backend", area: "api-hardening", severity: "P2", scope: serverCode,
    test: (c) => {
      const m = c.text.match(/\.get\(\s*['"](file|image|avatar|photo|upload|attachment|document|media)s?['"]\s*\)|\.upload\(\s*[^,]+,|instanceof\s+(File|Blob)\b/);
      if (!m) return false;
      if (/\.size\b|\.type\b|mime|content-?type|fileTypeFrom|magic|maxFileSize|MAX_(FILE|UPLOAD)|allowedTypes|ALLOWED_TYPES/i.test(c.text)) return false;
      return { line: c.text.slice(0, m.index).split("\n").length, text: "Upload accepted without size or type validation in this file" };
    },
  },
  {
    id: "webhook-no-signature", category: "backend", area: "api-hardening", severity: "P1", scope: serverCode,
    test: (c) => {
      if (!/webhook/i.test(c.file) && !/(stripe|revenuecat|svix|clerk|paddle|lemonsqueezy|github)[\s\S]{0,200}(event|webhook)/i.test(c.text)) return false;
      if (!/export\s+(async\s+)?(function|const)\s+POST\b|Deno\.serve|serve\(|req\.method\s*===?\s*['"]POST/.test(c.text)) return false;
      if (/constructEvent|constructEventAsync|verifySignature|verifyWebhook|Webhook\s*\(|\.verify\s*\(|timingSafeEqual|createHmac|crypto\.subtle\.(verify|importKey)|x-signature|stripe-signature|svix-signature|authorization/i.test(c.text)) return false;
      return { line: 1, text: "Webhook handler with no signature/secret verification in this file" };
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
