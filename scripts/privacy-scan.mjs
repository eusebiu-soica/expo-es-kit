#!/usr/bin/env node
// Collect privacy facts for App Store "App Privacy" + Google Play "Data safety" + iOS privacy manifest.
// Usage: node privacy-scan.mjs <appRoot> [--api=<apiRoot>] [--pretty]
// Read-only, zero deps. Output is a *draft evidence set* — the privacy skill must confirm each item in code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const appRoot = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const apiArg = args.find((a) => a.startsWith("--api="));
const apiRoot = apiArg ? path.resolve(apiArg.slice(6)) : null;
const pretty = args.includes("--pretty");

const catalogPath = path.join(here, "..", "skills", "privacy", "references", "sdk-catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");
const SKIP = new Set(["node_modules", ".git", ".expo", "dist", "build", "ios", "android", ".next", "coverage", "docs", ".claude", ".cursor"]);
function walk(root, out = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(path.join(root, e.name), out); }
    else if (e.isFile()) out.push(path.join(root, e.name));
  }
  return out;
}

const pkg = readJson(path.join(appRoot, "package.json"));
if (!pkg) { console.log(JSON.stringify({ error: `No package.json in ${appRoot}` })); process.exit(1); }
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const prodDeps = pkg.dependencies ?? {};
const appJsonRaw = readJson(path.join(appRoot, "app.json"));
const expo = appJsonRaw?.expo ?? appJsonRaw ?? {};
const dynamicConfig = ["app.config.ts", "app.config.js"].find((f) => fs.existsSync(path.join(appRoot, f))) ?? null;

// ---------- source text ----------
const srcFiles = walk(appRoot).filter((f) => /\.(t|j)sx?$|\.mjs$/.test(f) && !/\.d\.ts$/.test(f));
const sources = srcFiles.map((f) => ({ file: rel(appRoot, f), text: readText(f) ?? "" }));
function findInCode(signal) {
  const hits = [];
  for (const s of sources) {
    const i = s.text.indexOf(signal);
    if (i >= 0) hits.push(`${s.file}:${s.text.slice(0, i).split("\n").length}`);
    if (hits.length >= 5) break;
  }
  return hits;
}
function importedFiles(pkgName) {
  const re = new RegExp(`from\\s+['"]${pkgName.replace(/[/.*+?^${}()|[\]\\]/g, "\\$&")}(/[^'"]*)?['"]|require\\(['"]${pkgName.replace(/[/.*+?^${}()|[\]\\]/g, "\\$&")}`);
  return sources.filter((s) => re.test(s.text)).map((s) => s.file);
}

// ---------- SDKs ----------
const sdks = [];
for (const sdk of catalog.sdks ?? []) {
  const installed = (sdk.packages ?? []).filter((p) => deps[p]);
  if (!installed.length) continue;
  const used = installed.flatMap((p) => importedFiles(p));
  sdks.push({
    name: sdk.name,
    kind: sdk.kind,
    packages: installed.map((p) => `${p}@${deps[p]}`),
    devOnly: installed.every((p) => !prodDeps[p]),
    importedIn: [...new Set(used)].slice(0, 8),
    pluginConfigured: (expo.plugins ?? []).some((pl) => installed.includes(Array.isArray(pl) ? pl[0] : pl)),
    data: sdk.data ?? [],
    requiresATT: sdk.requiresATT ?? false,
    shipsPrivacyManifest: sdk.shipsPrivacyManifest ?? "unknown",
    docs: sdk.docs ?? null,
  });
}

// ---------- permissions ----------
const infoPlist = expo.ios?.infoPlist ?? {};
const androidPerms = new Set((expo.android?.permissions ?? []).map((p) => (p.includes(".") ? p : `android.permission.${p}`)));
const blocked = new Set((expo.android?.blockedPermissions ?? []).map((p) => (p.includes(".") ? p : `android.permission.${p}`)));
const pluginOptions = {};
for (const pl of expo.plugins ?? []) {
  if (Array.isArray(pl) && pl[1] && typeof pl[1] === "object") pluginOptions[pl[0]] = pl[1];
}
const permissions = [];
for (const perm of catalog.permissions ?? []) {
  const pkgInstalled = (perm.packages ?? []).filter((p) => deps[p]);
  const iosKeys = (perm.iosKeys ?? []).filter((k) => infoPlist[k] != null);
  const pluginKeys = [];
  for (const [p, o] of Object.entries(pluginOptions)) {
    for (const k of perm.configPluginOptions ?? []) if (o[k] !== undefined) pluginKeys.push(`${p}.${k}${o[k] === false ? " (disabled)" : ""}`);
  }
  const andDeclared = (perm.androidPermissions ?? []).filter((p) => androidPerms.has(p));
  const andBlocked = (perm.androidPermissions ?? []).filter((p) => blocked.has(p));
  const codeUse = (perm.codeSignals ?? []).flatMap((sig) => findInCode(sig)).slice(0, 6);
  if (!pkgInstalled.length && !iosKeys.length && !andDeclared.length && !pluginKeys.length && !codeUse.length) continue;
  const issues = [];
  if (codeUse.length && !iosKeys.length && !pluginKeys.length && (perm.iosKeys ?? []).length) issues.push("used in code but no iOS usage description (infoPlist key or config-plugin option) — App Store rejects this");
  if ((iosKeys.length || pluginKeys.length || andDeclared.length) && !codeUse.length && !pkgInstalled.length) issues.push("declared but no package/code use found — remove the declaration or the string");
  if (pkgInstalled.length && !codeUse.length) issues.push("package installed but no API call found — the config plugin may still add the permission; block it or remove the package");
  permissions.push({
    id: perm.id, packages: pkgInstalled, iosUsageKeys: iosKeys, configPluginOptions: pluginKeys,
    androidDeclared: andDeclared, androidBlocked: andBlocked, codeUse, data: perm.data ?? [], issues,
  });
}

// ---------- app's own data (DB schema + forms) ----------
function scanSchema(root) {
  if (!root) return [];
  const dirs = ["supabase/migrations", "supabase/schemas", "db/migrations", "migrations", "prisma"].map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
  const files = dirs.flatMap((d) => walk(d)).filter((f) => /\.(sql|prisma)$/.test(f));
  const kws = (catalog.schemaKeywords ?? []).map((k) => ({ ...k, re: new RegExp(k.pattern, "i") }));
  const found = new Map();
  for (const f of files) {
    const text = readText(f) ?? "";
    for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?\w+"?\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\);/gi)) {
      const table = m[1];
      for (const line of m[2].split("\n")) {
        const col = line.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i)?.[1];
        if (!col || /^(constraint|primary|unique|foreign|check)$/i.test(col)) continue;
        for (const k of kws) if (k.re.test(col)) {
          const key = `${k.apple}|${k.google}`;
          const e = found.get(key) ?? { apple: k.apple, google: k.google, columns: [] };
          if (e.columns.length < 12) e.columns.push(`${table}.${col} (${rel(root, f)})`);
          found.set(key, e);
        }
      }
    }
    for (const m of text.matchAll(/alter\s+table\s+(?:only\s+)?(?:"?\w+"?\.)?"?(\w+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi)) {
      for (const k of kws) if (k.re.test(m[2])) {
        const key = `${k.apple}|${k.google}`;
        const e = found.get(key) ?? { apple: k.apple, google: k.google, columns: [] };
        if (e.columns.length < 12) e.columns.push(`${m[1]}.${m[2]} (${rel(root, f)})`);
        found.set(key, e);
      }
    }
  }
  return [...found.values()];
}
const schemaData = (() => {
  const merged = new Map();
  for (const e of [...scanSchema(appRoot), ...scanSchema(apiRoot)]) {
    const key = `${e.apple}|${e.google}`;
    const m = merged.get(key) ?? { apple: e.apple, google: e.google, columns: [] };
    for (const c of e.columns) if (m.columns.length < 12 && !m.columns.includes(c)) m.columns.push(c);
    merged.set(key, m);
  }
  return [...merged.values()];
})();

const signals = {
  accountCreation: findInCode("signUp").concat(findInCode("createUser"), findInCode("register(")).slice(0, 5),
  accountDeletion: sources.filter((s) => /delete[_\s-]?account|deleteAccount|account[_\s-]?deletion|deleteUser/i.test(s.text)).map((s) => s.file).slice(0, 8),
  attRequest: findInCode("requestTrackingPermissionsAsync"),
  advertisingId: findInCode("getAdvertisingId").concat(findInCode("getIosIdForVendorAsync"), findInCode("getAndroidId")).slice(0, 5),
  analyticsIdentify: sources.filter((s) => /\.(identify|setUserId|setUser|logIn)\s*\(/.test(s.text) && /(posthog|amplitude|mixpanel|segment|analytics|sentry|Purchases|crashlytics)/i.test(s.text)).map((s) => s.file).slice(0, 8),
  httpsOnly: !sources.some((s) => /['"`]http:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2)/.test(s.text)),
  privacyPolicyLink: sources.filter((s) => /privacy[-_ ]?policy|\/privacy\b/i.test(s.text)).map((s) => s.file).slice(0, 5),
};

// ---------- privacy manifest ----------
const pm = expo.ios?.privacyManifests ?? null;
const manifest = {
  configured: Boolean(pm),
  source: dynamicConfig ? `${dynamicConfig} (dynamic — read it; app.json may be partial)` : "app.json",
  tracking: pm?.NSPrivacyTracking ?? null,
  trackingDomains: pm?.NSPrivacyTrackingDomains ?? [],
  accessedApiTypes: (pm?.NSPrivacyAccessedAPITypes ?? []).map((t) => ({ type: t.NSPrivacyAccessedAPIType, reasons: t.NSPrivacyAccessedAPITypeReasons ?? [] })),
  collectedDataTypes: (pm?.NSPrivacyCollectedDataTypes ?? []).length,
  requiredReasonCandidates: (catalog.requiredReasonApis ?? []).map((r) => ({
    category: r.category,
    declared: (pm?.NSPrivacyAccessedAPITypes ?? []).some((t) => t.NSPrivacyAccessedAPIType === r.category),
    likelySources: (r.typicalSources ?? []).filter((s) => s.endsWith("*") ? Object.keys(deps).some((d) => d.startsWith(s.slice(0, -1))) : deps[s]),
    allowedReasons: (r.reasons ?? []).map((x) => x.code),
  })),
  generatedFile: ["ios"].map((d) => path.join(appRoot, d)).filter((d) => fs.existsSync(d)).flatMap((d) => walk(d)).filter((f) => f.endsWith("PrivacyInfo.xcprivacy")).map((f) => rel(appRoot, f)),
};

const result = {
  tool: "expo-es-kit/privacy-scan",
  generatedAt: new Date().toISOString(),
  appRoot, apiRoot,
  app: { name: expo.name ?? pkg.name, bundleId: expo.ios?.bundleIdentifier ?? null, package: expo.android?.package ?? null, expo: deps.expo ?? null },
  catalogVersion: catalog.version,
  sdks,
  permissions,
  schemaData,
  signals,
  manifest,
  notes: [
    "Draft evidence only: confirm every item by reading code and vendor configuration before filling the store forms.",
    "Data your own backend stores is 'collected' even if no third party sees it.",
  ],
};
process.stdout.write(JSON.stringify(result, null, pretty ? 2 : 0) + "\n");
