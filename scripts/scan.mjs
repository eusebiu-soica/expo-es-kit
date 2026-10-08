#!/usr/bin/env node
// expo-es-kit static scanner — zero dependencies, read-only.
// Usage: node scan.mjs <appRoot> [--api=<apiRoot>] [--files=a.ts,b.tsx] [--summary] [--pretty]
// Prints one JSON document with stack facts, config facts and rule hits (file:line samples).
// Never prints secret values: env values are not read into the output and secret-looking literals are redacted.

import fs from "node:fs";
import path from "node:path";
import { RULES, FILE_RULES, redact } from "./rules.mjs";
import { SOURCE_EXT, SKIP_DIRS, readJson, readText, rel, walk, git, verOf } from "./lib.mjs";

const VERSION = "0.3.0";
const MAX_SAMPLES = 12;
const MAX_FILE_BYTES = 600_000;

// ---------- args ----------
const args = process.argv.slice(2);
const appRoot = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const apiArg = args.find((a) => a.startsWith("--api="));
const apiRoot = apiArg ? path.resolve(apiArg.slice(6)) : null;
const filesArg = args.find((a) => a.startsWith("--files="));
const onlyFiles = filesArg ? filesArg.slice(8).split(",").filter(Boolean).map((f) => path.resolve(appRoot, f)) : null;
const pretty = args.includes("--pretty");

if (!fs.existsSync(path.join(appRoot, "package.json"))) {
  fail(`No package.json in ${appRoot}`);
}

// ---------- helpers ----------
function fail(msg) {
  process.stdout.write(JSON.stringify({ error: msg }) + "\n");
  process.exit(1);
}
function addHit(store, id, root, file, line, text) {
  const h = (store[id] ??= { count: 0, files: new Set(), samples: [] });
  h.count++;
  h.files.add(rel(root, file));
  if (h.samples.length < MAX_SAMPLES) {
    h.samples.push({ file: rel(root, file), line, text: redact(text.trim()).slice(0, 180) });
  }
}
function finalizeHits(store) {
  const out = {};
  for (const [id, h] of Object.entries(store)) {
    out[id] = { count: h.count, fileCount: h.files.size, samples: h.samples };
  }
  return out;
}

// ---------- stack ----------
const pkg = readJson(path.join(appRoot, "package.json")) ?? {};
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const has = (n) => Boolean(deps[n]);
const appJsonRaw = readJson(path.join(appRoot, "app.json"));
const appJson = appJsonRaw?.expo ?? appJsonRaw ?? null;
const appConfigFile = ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"].find((f) => fs.existsSync(path.join(appRoot, f))) ?? null;
const appConfigText = appConfigFile ? readText(path.join(appRoot, appConfigFile)) : null;

const stack = {
  name: pkg.name ?? null,
  expo: verOf(pkg, "expo"),
  reactNative: verOf(pkg, "react-native"),
  react: verOf(pkg, "react"),
  typescript: verOf(pkg, "typescript"),
  router: has("expo-router") ? "expo-router" : has("@react-navigation/native") ? "react-navigation" : null,
  routerVersion: verOf(pkg, "expo-router"),
  libs: {},
};
const LIBS = [
  "react-native-mmkv", "expo-secure-store", "@react-native-async-storage/async-storage", "expo-sqlite",
  "@tanstack/react-query", "@tanstack/react-query-persist-client", "@tanstack/query-async-storage-persister",
  "@tanstack/query-sync-storage-persister", "zustand", "jotai", "@reduxjs/toolkit", "redux", "mobx", "@legendapp/state",
  "@supabase/supabase-js", "firebase", "@react-native-firebase/app", "drizzle-orm", "@nozbe/watermelondb",
  "@shopify/flash-list", "@legendapp/list", "expo-image", "react-native-fast-image",
  "react-native-reanimated", "react-native-worklets", "react-native-gesture-handler", "@gorhom/bottom-sheet",
  "@shopify/react-native-skia", "lottie-react-native", "moti",
  "heroui-native", "uniwind", "nativewind", "tailwindcss", "tailwind-variants", "tailwind-merge", "tamagui", "react-native-paper",
  "@sentry/react-native", "expo-updates", "expo-dev-client", "@react-native-community/netinfo", "patch-package",
  "expo-local-authentication", "expo-auth-session", "expo-web-browser", "expo-crypto", "expo-font", "expo-splash-screen",
  "react-native-purchases", "@stripe/stripe-react-native", "expo-notifications", "expo-constants",
  "zod", "axios", "ky", "moment", "lodash", "lodash-es", "date-fns", "dayjs", "crypto-js", "react-native-webview",
  "react-native-svg", "expo-insights", "react-native-performance", "@shopify/react-native-performance",
];
for (const l of LIBS) if (has(l)) stack.libs[l] = deps[l];

// ---------- config ----------
const easJson = readJson(path.join(appRoot, "eas.json"));
const babelText = readText(path.join(appRoot, "babel.config.js")) ?? readText(path.join(appRoot, "babel.config.cjs"));
const metroText = readText(path.join(appRoot, "metro.config.js")) ?? readText(path.join(appRoot, "metro.config.cjs"));
const tsconfig = readJson(path.join(appRoot, "tsconfig.json"));

function pluginNames(cfg) {
  return (cfg?.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p)).filter((p) => typeof p === "string");
}
const config = {
  appConfigFile: appConfigFile ?? (appJson ? "app.json" : null),
  dynamicConfig: Boolean(appConfigFile),
  newArchEnabled: appJson?.newArchEnabled ?? null,
  jsEngine: appJson?.jsEngine ?? "hermes (default)",
  reactCompiler: appJson?.experiments?.reactCompiler ?? null,
  typedRoutes: appJson?.experiments?.typedRoutes ?? null,
  scheme: appJson?.scheme ?? null,
  userInterfaceStyle: appJson?.userInterfaceStyle ?? null,
  runtimeVersion: appJson?.runtimeVersion ?? null,
  updates: appJson?.updates ?? null,
  ios: appJson?.ios ? {
    bundleIdentifier: appJson.ios.bundleIdentifier ?? null,
    buildNumber: appJson.ios.buildNumber ?? null,
    usageDescriptionKeys: Object.keys(appJson.ios.infoPlist ?? {}).filter((k) => k.endsWith("UsageDescription")),
    hasPrivacyManifests: Boolean(appJson.ios.privacyManifests),
    associatedDomains: appJson.ios.associatedDomains ?? null,
    nsAllowsArbitraryLoads: appJson.ios.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads ?? null,
    usesNonExemptEncryption: appJson.ios.config?.usesNonExemptEncryption ?? appJson.ios.infoPlist?.ITSAppUsesNonExemptEncryption ?? null,
  } : null,
  android: appJson?.android ? {
    package: appJson.android.package ?? null,
    versionCode: appJson.android.versionCode ?? null,
    permissions: appJson.android.permissions ?? null,
    blockedPermissions: appJson.android.blockedPermissions ?? null,
    allowBackup: appJson.android.allowBackup ?? null,
    usesCleartextTraffic: appJson.android.usesCleartextTraffic ?? null,
    edgeToEdgeEnabled: appJson.android.edgeToEdgeEnabled ?? null,
    intentFilters: Boolean(appJson.android.intentFilters?.length),
    googleServicesFile: appJson.android.googleServicesFile ?? null,
  } : null,
  plugins: pluginNames(appJson),
  eas: easJson ? {
    cliVersion: easJson.cli?.version ?? null,
    appVersionSource: easJson.cli?.appVersionSource ?? null,
    profiles: Object.fromEntries(Object.entries(easJson.build ?? {}).map(([k, v]) => [k, {
      channel: v.channel ?? null,
      distribution: v.distribution ?? null,
      developmentClient: v.developmentClient ?? false,
      autoIncrement: v.autoIncrement ?? false,
      envKeys: Object.keys(v.env ?? {}),
      extends: v.extends ?? null,
    }])),
    submit: Boolean(easJson.submit),
  } : null,
  babel: babelText ? {
    plugins: [...babelText.matchAll(/['"]((?:@[\w-]+\/)?[\w./-]+(?:\/plugin)?)['"]/g)].map((m) => m[1])
      .filter((n) => /plugin|reanimated|worklets|compiler|module-resolver|dotenv|nativewind|uniwind/.test(n)),
    reanimatedOrWorkletsPluginLast: (() => {
      const idx = Math.max(babelText.lastIndexOf("react-native-reanimated/plugin"), babelText.lastIndexOf("react-native-worklets/plugin"));
      if (idx < 0) return null;
      const after = babelText.slice(idx + 30);
      return !/['"][\w@/-]+\/plugin['"]|['"]babel-plugin-[\w-]+['"]|['"]module-resolver['"]/.test(after);
    })(),
    removeConsole: /transform-remove-console/.test(babelText),
  } : null,
  metro: metroText ? {
    inlineRequires: /inlineRequires\s*:\s*true/.test(metroText),
    customized: /getDefaultConfig/.test(metroText),
  } : null,
  tsStrict: tsconfig?.compilerOptions?.strict ?? null,
  scripts: pkg.scripts ?? {},
};

// ---------- env files (key names only, never values) ----------
const envFiles = fs.readdirSync(appRoot).filter((f) => /^\.env(\..+)?$/.test(f));
const gitTracked = git(appRoot, ["ls-files"]);
const trackedSet = gitTracked ? new Set(gitTracked.split("\n").filter(Boolean)) : null;
const SECRETISH = /(SECRET|PRIVATE|SERVICE_ROLE|SERVICE_KEY|PASSWORD|PASSWD|ADMIN|SK_LIVE|SK_TEST|WEBHOOK|SIGNING|ACCESS_KEY|CLIENT_SECRET|DATABASE_URL|DB_URL|PEPPER|SALT)/i;
const env = {
  files: envFiles.map((f) => ({
    file: f,
    trackedByGit: trackedSet ? trackedSet.has(f) : null,
    keys: (readText(path.join(appRoot, f)) ?? "").split("\n")
      .map((l) => l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/)?.[1]).filter(Boolean)
      .map((name) => ({ name, public: name.startsWith("EXPO_PUBLIC_"), looksSecret: SECRETISH.test(name) })),
  })),
  easEnvKeys: [...new Set(Object.values(config.eas?.profiles ?? {}).flatMap((p) => p.envKeys))]
    .map((name) => ({ name, public: name.startsWith("EXPO_PUBLIC_"), looksSecret: SECRETISH.test(name) })),
};
env.publicSecretLooking = [...new Set([...env.files.flatMap((f) => f.keys), ...env.easEnvKeys]
  .filter((k) => k.public && k.looksSecret).map((k) => k.name))];

const sensitiveTracked = trackedSet
  ? [...trackedSet].filter((f) => /(^|\/)\.env(\.(?!example|sample|template)[\w.-]+)?$|google-services\.json$|GoogleService-Info\.plist$|\.(jks|keystore|p8|p12|pem|mobileprovision)$|credentials\.json$|service-account.*\.json$/i.test(f))
  : null;

const git_ = {
  isRepo: Boolean(gitTracked),
  sensitiveTrackedFiles: sensitiveTracked,
  gitignoreHasEnv: /(^|\n)\s*\.env/.test(readText(path.join(appRoot, ".gitignore")) ?? ""),
};

// ---------- source scan ----------
const allFiles = walk(appRoot);
const sourceFiles = (onlyFiles ?? allFiles).filter((f) => SOURCE_EXT.has(path.extname(f)) && !/\.d\.ts$/.test(f));
const hitStore = {};
const fileFacts = {};
let lines = 0;

for (const file of sourceFiles) {
  let text;
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
    text = fs.readFileSync(file, "utf8");
  } catch { continue; }
  const r = rel(appRoot, file);
  const fileLines = text.split("\n");
  lines += fileLines.length;
  const ctx = { file: r, ext: path.extname(file), text };
  for (const rule of RULES) {
    if (rule.scope && !rule.scope(ctx)) continue;
    fileLines.forEach((ln, i) => {
      if (rule.re.test(ln) && !(rule.not && rule.not.test(ln))) addHit(hitStore, rule.id, appRoot, file, i + 1, ln);
    });
  }
  for (const fr of FILE_RULES) {
    if (fr.scope && !fr.scope(ctx)) continue;
    const res = fr.test(ctx);
    if (res) {
      const line = typeof res === "object" && res.line ? res.line : 1;
      const sample = typeof res === "object" && res.text ? res.text : r;
      addHit(hitStore, fr.id, appRoot, file, line, sample);
    }
  }
  if (ctx.ext === ".tsx" || ctx.ext === ".jsx") {
    fileFacts[r] = { lines: fileLines.length };
  }
}

// largest components (render-cost suspects)
const largestComponents = Object.entries(fileFacts).sort((a, b) => b[1].lines - a[1].lines).slice(0, 10)
  .map(([file, f]) => ({ file, lines: f.lines }));

// ---------- folder map ----------
function topDirs(root, depth = 2) {
  const out = [];
  const rec = (dir, d) => {
    if (d > depth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      const count = walk(full).filter((f) => SOURCE_EXT.has(path.extname(f))).length;
      out.push({ dir: rel(root, full), sourceFiles: count, hasClaudeMd: fs.existsSync(path.join(full, "CLAUDE.md")) });
      rec(full, d + 1);
    }
  };
  rec(root, 1);
  return out.filter((d) => d.sourceFiles > 0 || d.hasClaudeMd);
}

const claudeConfig = {
  rootClaudeMd: fs.existsSync(path.join(appRoot, "CLAUDE.md")),
  rootClaudeMdLines: (readText(path.join(appRoot, "CLAUDE.md")) ?? "").split("\n").length,
  nestedClaudeMd: allFiles.filter((f) => path.basename(f) === "CLAUDE.md" && path.dirname(f) !== appRoot).map((f) => rel(appRoot, f)),
  rules: listDir(path.join(appRoot, ".claude", "rules")),
  skills: listDir(path.join(appRoot, ".claude", "skills")),
  agents: listDir(path.join(appRoot, ".claude", "agents")),
  cursorRules: listDir(path.join(appRoot, ".cursor", "rules")),
  agentsMd: fs.existsSync(path.join(appRoot, "AGENTS.md")),
};
function listDir(p) { try { return fs.readdirSync(p); } catch { return []; } }

// ---------- supabase migrations (RLS) ----------
function scanMigrations(root) {
  const dirs = ["supabase/migrations", "supabase/schemas", "db/migrations", "migrations"].map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
  if (!dirs.length) return null;
  const sqlFiles = dirs.flatMap((d) => walk(d)).filter((f) => f.endsWith(".sql")).sort();
  const tables = {};
  const definerNoSearchPath = [];
  const anonGrants = [];
  const definerFns = [];
  for (const f of sqlFiles) {
    const sql = readText(f) ?? "";
    const lower = sql.toLowerCase();
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi)) {
      const schema = (m[1] ?? "public").toLowerCase();
      if (schema !== "public") continue;
      const t = m[2].toLowerCase();
      tables[t] ??= { rls: false, policies: 0, createdIn: rel(root, f) };
    }
    const tbl = (schema, name) => ((schema ?? "public").replace(/"/g, "") === "public" ? name.replace(/"/g, "") : null);
    for (const m of lower.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:("?\w+"?)\.)?("?\w+"?)\s+enable\s+row\s+level\s+security/g)) {
      const t = tbl(m[1], m[2]);
      if (t) (tables[t] ??= { rls: false, policies: 0, createdIn: null }).rls = true;
    }
    for (const m of lower.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:("?\w+"?)\.)?("?\w+"?)\s+disable\s+row\s+level\s+security/g)) {
      const t = tbl(m[1], m[2]);
      if (t && tables[t]) tables[t].rls = false;
    }
    for (const m of lower.matchAll(/create\s+policy\s+(?:"[^"]+"|\w+)\s+on\s+(?:("?\w+"?)\.)?("?\w+"?)/g)) {
      const t = tbl(m[1], m[2]);
      if (t) (tables[t] ??= { rls: false, policies: 0, createdIn: null }).policies++;
    }
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(([\s\S]*?)\$\$/gi)) {
      const head = m[0].toLowerCase();
      if (head.includes("security definer")) {
        definerFns.push(m[1].replace(/"/g, ""));
        if (!/set\s+search_path/.test(head)) definerNoSearchPath.push({ fn: m[1].replace(/"/g, ""), file: rel(root, f) });
      }
    }
    for (const m of lower.matchAll(/grant\s+([\w,\s]+)\s+on\s+(?:table\s+)?([\w."]+)\s+to\s+anon/g)) {
      anonGrants.push({ privileges: m[1].trim(), on: m[2], file: rel(root, f) });
    }
    if (/using\s*\(\s*true\s*\)/.test(lower)) {
      for (const m of lower.matchAll(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w."]+)[\s\S]{0,300}?using\s*\(\s*true\s*\)/g)) {
        anonGrants.push({ privileges: "policy using (true)", on: m[2], policy: m[1], file: rel(root, f) });
      }
    }
  }
  const rows = Object.entries(tables).map(([t, v]) => ({ table: t, ...v }));
  return {
    migrationFiles: sqlFiles.length,
    tables: rows.length,
    tablesWithoutRls: rows.filter((r) => !r.rls).map((r) => r.table),
    tablesRlsNoPolicies: rows.filter((r) => r.rls && r.policies === 0).map((r) => r.table),
    securityDefinerFunctions: definerFns.length,
    securityDefinerWithoutSearchPath: definerNoSearchPath,
    permissiveGrantsOrPolicies: anonGrants.slice(0, 30),
    authUidNotWrapped: (() => {
      let n = 0;
      for (const f of sqlFiles) {
        const s = (readText(f) ?? "").toLowerCase();
        n += (s.match(/(?<!select\s)auth\.uid\(\)/g) ?? []).length - (s.match(/\(\s*select\s+auth\.uid\(\)\s*\)/g) ?? []).length;
      }
      return Math.max(0, n);
    })(),
  };
}

// ---------- API routes ----------
function scanApi(root) {
  if (!root || !fs.existsSync(root)) return null;
  const files = walk(root).filter((f) => SOURCE_EXT.has(path.extname(f)));
  const routes = [];
  for (const f of files) {
    const r = rel(root, f);
    let framework = null;
    if (/(^|\/)app\/api\/.*\/?route\.(t|j)sx?$/.test(r) || /(^|\/)pages\/api\//.test(r)) framework = "nextjs";
    else if (/(^|\/)supabase\/functions\/[^/]+\/index\.(t|j)s$/.test(r)) framework = "supabase-edge";
    else if (/\+api\.(t|j)sx?$/.test(r)) framework = "expo-api-routes";
    if (!framework) continue;
    const t = readText(f) ?? "";
    routes.push({
      file: r,
      framework,
      methods: [...t.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]),
      auth: /getUser\(|getClaims\(|jwtVerify|verifyJwt|verifyToken|\brequire\w*(Auth|User|Session)\w*\(|\bwith\w*Auth|\bassert\w*(Auth|User|Session)|\bensure\w*(Auth|User|Session)|authenticate|auth\(\)|getServerSession|currentUser\(|validateSession|Authorization/i.test(t),
      publicMarker: /@public|isPublic|publicRoute|allowAnonymous|webhook/i.test(t),
      decodeOnly: /jwt-decode|jwtDecode|decodeJwt|atob\(.*split\(['"]\.['"]\)/.test(t) && !/jwtVerify|verify\(/.test(t),
      validation: /\bz\.|safeParse|\.parse\(|zod|valibot|yup|ajv|typebox/i.test(t),
      rateLimit: /ratelimit|rateLimit|rate-limit|limiter|upstash|throttle/i.test(t),
      serviceRole: /service_role|SERVICE_ROLE|serviceRole/i.test(t),
      leaksErrors: /(Response\.json|NextResponse\.json|new Response)\([^)]*(error\.message|err\.message|e\.message|error\.stack|JSON\.stringify\(\s*(error|err|e)\s*\))/.test(t),
      corsWildcard: /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/.test(t),
      idempotency: /idempotency|Idempotency-Key/i.test(t),
      lines: t.split("\n").length,
    });
  }
  // Shared helpers (auth guards, handler wrappers, rate limiters) imported by routes: auditors must read these once.
  const helperCounts = {};
  for (const f of files) {
    const r = rel(root, f);
    if (!routes.some((x) => x.file === r)) continue;
    const t = readText(f) ?? "";
    for (const m of t.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      if (!/^(@\/|\.|~\/|src\/)/.test(m[2])) continue;
      for (const name of m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        if (/auth|session|guard|handler|rate|limit|error|cors|idempot|require|with[A-Z]/i.test(name)) {
          const key = `${name} <- ${m[2]}`;
          helperCounts[key] = (helperCounts[key] ?? 0) + 1;
        }
      }
    }
  }
  const sharedHelpers = Object.entries(helperCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, c]) => ({ helper: k, usedInRoutes: c }));
  const pk = readJson(path.join(root, "package.json"));
  return {
    root: root === appRoot ? "." : root,
    package: pk?.name ?? null,
    next: verOf(pk, "next"),
    routeCount: routes.length,
    frameworks: [...new Set(routes.map((r) => r.framework))],
    sharedHelpers,
    routesWithoutAuthSignal: routes.filter((r) => !r.auth).map((r) => ({ file: r.file, publicMarker: r.publicMarker })),
    routesWithoutValidation: routes.filter((r) => r.methods.some((m) => m !== "GET") && !r.validation).map((r) => r.file),
    routesWithoutInlineRateLimit: routes.filter((r) => !r.rateLimit).length,
    note: "Signals only. Auth/rate-limit/error handling may live in sharedHelpers or middleware — read those before reporting.",
    decodeOnlyAuth: routes.filter((r) => r.decodeOnly).map((r) => r.file),
    errorLeaks: routes.filter((r) => r.leaksErrors).map((r) => r.file),
    corsWildcard: routes.filter((r) => r.corsWildcard).map((r) => r.file),
    serviceRoleRoutes: routes.filter((r) => r.serviceRole).map((r) => r.file),
    middleware: ["middleware.ts", "src/middleware.ts", "proxy.ts", "src/proxy.ts"].filter((m) => fs.existsSync(path.join(root, m))),
    routes: routes.slice(0, 80),
    migrations: scanMigrations(root),
  };
}

// ---------- backend mode ----------
const hits = finalizeHits(hitStore);
const n = (id) => hits[id]?.count ?? 0;
function detectMode() {
  const directDb = n("supabase-table-access") + n("firebase-firestore") > 0;
  const rpc = n("supabase-rpc") > 0;
  const api = n("api-fetch") + n("api-client") > 0 || Boolean(apiRoot);
  const localApiRoutes = allFiles.some((f) => /\+api\.(t|j)sx?$/.test(f));
  let mode = "none";
  if ((directDb || rpc) && api) mode = "hybrid";
  else if (directDb || rpc) mode = "direct-db";
  else if (api || localApiRoutes) mode = "api";
  return {
    mode,
    signals: {
      supabaseTableAccess: n("supabase-table-access"),
      supabaseRpc: n("supabase-rpc"),
      firestore: n("firebase-firestore"),
      apiFetchCalls: n("api-fetch") + n("api-client"),
      expoApiRoutesInApp: localApiRoutes,
      apiRootGiven: Boolean(apiRoot),
    },
  };
}

const result = {
  tool: "expo-es-kit/scan",
  version: VERSION,
  generatedAt: new Date().toISOString(),
  appRoot,
  apiRoot,
  partial: Boolean(onlyFiles),
  totals: { sourceFiles: sourceFiles.length, lines },
  stack,
  config,
  env,
  git: git_,
  backend: detectMode(),
  claudeConfig,
  folders: onlyFiles ? undefined : topDirs(appRoot, 2),
  largestComponents,
  hits,
  appMigrations: onlyFiles ? undefined : scanMigrations(appRoot),
  appApiRoutes: onlyFiles ? undefined : scanApi(appRoot)?.routeCount ? scanApi(appRoot) : null,
  api: apiRoot ? scanApi(apiRoot) : null,
};

// --summary: compact view for reading into context (~5–10x smaller). Full details stay in the full scan.
if (args.includes("--summary")) {
  result.summary = true;
  result.hits = Object.fromEntries(Object.entries(result.hits).map(([k, v]) => [k, { count: v.count, fileCount: v.fileCount, samples: v.samples.slice(0, 2) }]));
  if (result.folders) result.folders = result.folders.filter((d) => d.sourceFiles >= 5 || d.hasClaudeMd);
  const trim = (o) => {
    if (!o) return o;
    const c = { ...o };
    delete c.routes;
    for (const k of ["routesWithoutAuthSignal", "routesWithoutValidation", "decodeOnlyAuth", "errorLeaks", "corsWildcard", "serviceRoleRoutes"]) {
      if (Array.isArray(c[k]) && c[k].length > 15) c[k] = [...c[k].slice(0, 15), `… +${c[k].length - 15} more (see full scan)`];
    }
    return c;
  };
  result.api = trim(result.api);
  result.appApiRoutes = trim(result.appApiRoutes);
}

process.stdout.write(JSON.stringify(result, null, pretty ? 2 : 0) + "\n");
