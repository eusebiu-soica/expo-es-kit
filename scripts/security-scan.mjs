#!/usr/bin/env node
// expo-es-kit security scanner — zero dependencies, read-only.
// Usage: node security-scan.mjs <appRoot> [--api=<apiRoot>] [--history] [--max-commits=2000] [--summary] [--pretty]
//
// Complements scan.mjs with facts a single-line regex can't give:
//   hits            security rules (rules.mjs entries with an `area`) over the app AND the API repo
//   inputSurfaces   screens/components with text inputs → the sinks they reach (DB, RPC, API, navigation)
//   rls             every CREATE POLICY parsed (command, roles, using / with check) + predicate issues
//   sqlDynamic      dynamic SQL inside plpgsql functions (EXECUTE with || or format('%s'))
//   gitHistorySecrets (--history) secrets and credential files that ever entered git history (redacted)
//   urlParams       every query-string parameter name built in code, sensitive ones first
//   webHardening    security headers, CSP, cookie flags, CSRF signals, CORS wildcards (API / web)
//   supplyChain     lockfiles, git/url dependencies, install scripts, patches
// Signals only: auditors read the code before turning anything into a finding.
// Never prints secret values (redacted) and never reads .env values.

import fs from "node:fs";
import path from "node:path";
import { RULES, FILE_RULES, redact } from "./rules.mjs";
import { SOURCE_EXT, readJson, readText, rel, walk, git, verOf, lineOf } from "./lib.mjs";

const VERSION = "0.3.0";
const MAX_FILE_BYTES = 600_000;

const args = process.argv.slice(2);
const appRoot = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const apiArg = args.find((a) => a.startsWith("--api="));
const apiRoot = apiArg ? path.resolve(apiArg.slice(6)) : null;
const summary = args.includes("--summary");
const pretty = args.includes("--pretty");
const withHistory = args.includes("--history");
const maxCommits = Number(args.find((a) => a.startsWith("--max-commits="))?.slice(14) ?? 2000);
const MAX_SAMPLES = summary ? 3 : 15;

if (!fs.existsSync(path.join(appRoot, "package.json"))) {
  process.stdout.write(JSON.stringify({ error: `No package.json in ${appRoot}` }) + "\n");
  process.exit(1);
}

// ---------- sources ----------
const roots = [{ name: "app", dir: appRoot, server: undefined }];
if (apiRoot && apiRoot !== appRoot && fs.existsSync(apiRoot)) roots.push({ name: "api", dir: apiRoot, server: true });

const files = []; // { root, abs, rel, ext, text, server }
for (const r of roots) {
  for (const abs of walk(r.dir)) {
    const ext = path.extname(abs);
    if (!SOURCE_EXT.has(ext) || /\.d\.ts$/.test(abs)) continue;
    let text;
    try {
      if (fs.statSync(abs).size > MAX_FILE_BYTES) continue;
      text = fs.readFileSync(abs, "utf8");
    } catch { continue; }
    files.push({ root: r.name, dir: r.dir, abs, rel: rel(r.dir, abs), ext, text, server: r.server });
  }
}
const loc = (f, line) => `${f.root === "api" ? "api:" : ""}${f.rel}:${line}`;

// ---------- 1. security rule hits (app + api) ----------
const SEC_RULES = RULES.filter((r) => r.area);
const SEC_FILE_RULES = FILE_RULES.filter((r) => r.area);
const hits = {};
function addHit(rule, f, line, text) {
  const h = (hits[rule.id] ??= { area: rule.area, category: rule.category, severity: rule.severity ?? null, count: 0, files: new Set(), samples: [] });
  h.count++;
  h.files.add(`${f.root}:${f.rel}`);
  if (h.samples.length < MAX_SAMPLES) h.samples.push({ at: loc(f, line), text: redact(String(text).trim()).slice(0, 180) });
}
for (const f of files) {
  const ctx = { file: f.rel, ext: f.ext, text: f.text, server: f.server };
  const lines = f.text.split("\n");
  for (const rule of SEC_RULES) {
    if (rule.scope && !rule.scope(ctx)) continue;
    lines.forEach((ln, i) => {
      if (rule.re.test(ln) && !(rule.not && rule.not.test(ln))) addHit(rule, f, i + 1, ln);
    });
  }
  for (const fr of SEC_FILE_RULES) {
    if (fr.scope && !fr.scope(ctx)) continue;
    const res = fr.test(ctx);
    if (res) addHit(fr, f, typeof res === "object" ? res.line ?? 1 : 1, typeof res === "object" ? res.text ?? f.rel : f.rel);
  }
}
const hitsOut = Object.fromEntries(Object.entries(hits)
  .sort((a, b) => sevRank(a[1].severity) - sevRank(b[1].severity) || b[1].count - a[1].count)
  .map(([id, h]) => [id, { area: h.area, category: h.category, severity: h.severity, count: h.count, fileCount: h.files.size, samples: h.samples }]));
function sevRank(s) { return s === "P0" ? 0 : s === "P1" ? 1 : s === "P2" ? 2 : 3; }

// ---------- 2. input surfaces → sinks ----------
const INPUT_RE = /<(TextInput|TextField|TextArea|Input|SearchBar|OTPInput|input|textarea)\b|useForm\s*\(|<Controller\b|onChangeText=/g;
const SINK_RES = [
  ["db", /\.from\(\s*['"`](\w+)['"`]\s*\)[\s\S]{0,120}?\.(insert|update|upsert|delete|select)\s*\(/g, (m) => `${m[1]}.${m[2]}`],
  ["rpc", /\.rpc\(\s*['"`](\w+)['"`]/g, (m) => `rpc ${m[1]}`],
  ["filter-string", /\.(or|filter)\(\s*`/g, (m) => `.${m[1]}(\`…\`)`],
  ["storage", /\.storage\s*\.from\(\s*['"`]([\w-]+)['"`]\s*\)\s*\.(upload|update|remove|createSignedUrl)/g, (m) => `storage ${m[1]}.${m[2]}`],
  ["api", /\b(fetch|api(?:Client)?\.(?:get|post|put|patch|delete)|axios\.(?:get|post|put|patch|delete)|ky\.(?:get|post|put|patch|delete))\s*\(\s*(`[^`]{0,80}`|['"][^'"]{0,80}['"]|[\w.]+)/g, (m) => `${m[1]} ${m[2].slice(0, 60)}`],
  ["sqlite", /\.(execAsync|runAsync|getAllAsync|getFirstAsync|executeSql)\s*\(/g, (m) => `sqlite ${m[1]}`],
  ["navigation", /router\.(push|replace|navigate)\s*\(\s*(`[^`]{0,60}`|\{[^}]{0,60})/g, (m) => `router.${m[1]} ${m[2].slice(0, 50)}`],
  ["webview", /injectJavaScript\s*\(|source=\{\{\s*html/g, () => "webview html/js"],
  ["mutation", /\buseMutation\s*\(|\.mutate(Async)?\s*\(/g, () => "react-query mutation"],
];
const fileIndex = new Map(files.map((f) => [f.abs, f]));
function resolveImport(f, spec) {
  let base;
  if (spec.startsWith(".")) base = path.resolve(path.dirname(f.abs), spec);
  else if (/^(@|~)\//.test(spec)) base = null;
  else return null;
  const bases = base ? [base] : [path.join(f.dir, spec.slice(2)), path.join(f.dir, "src", spec.slice(2))];
  for (const b of bases) {
    for (const c of [b, ...[".ts", ".tsx", ".js", ".jsx"].map((e) => b + e), ...["index.ts", "index.tsx", "index.js"].map((e) => path.join(b, e))]) {
      if (fileIndex.has(c)) return fileIndex.get(c);
    }
  }
  return null;
}
function sinksOf(f) {
  const out = [];
  for (const [kind, re, label] of SINK_RES) {
    for (const m of f.text.matchAll(re)) {
      out.push({ kind, sink: label(m).replace(/\s+/g, " ").trim(), at: loc(f, lineOf(f.text, m.index)) });
      if (out.length > 25) return out;
    }
  }
  return out;
}
const inputSurfaces = [];
for (const f of files) {
  if (f.root !== "app" || !(f.ext === ".tsx" || f.ext === ".jsx")) continue;
  const inputs = [];
  for (const m of f.text.matchAll(INPUT_RE)) {
    const tagText = f.text.slice(m.index, m.index + 400);
    const label = tagText.match(/(placeholder|label|name|accessibilityLabel)=\{?\s*['"`]([^'"`]{1,40})['"`]/)?.[2] ?? null;
    inputs.push({ kind: m[1] ?? m[0].replace(/[\s(=<]/g, ""), label, line: lineOf(f.text, m.index), secure: /secureTextEntry/.test(tagText) || undefined });
    if (inputs.length >= 12) break;
  }
  if (!inputs.length) continue;
  const sinks = sinksOf(f);
  const followed = [];
  for (const m of f.text.matchAll(/import\s+(?:[\w*{}\s,]+)\s+from\s+['"]([^'"]+)['"]/g)) {
    const target = resolveImport(f, m[1]);
    if (!target || target === f) continue;
    const s = sinksOf(target);
    if (s.length) { followed.push(target.rel); sinks.push(...s.slice(0, 8)); }
    if (followed.length >= 6) break;
  }
  inputSurfaces.push({ file: f.rel, inputs, sinks: dedupeBy(sinks, (s) => s.sink).slice(0, 20), importsFollowed: followed });
}
inputSurfaces.sort((a, b) => b.sinks.length - a.sinks.length);
function dedupeBy(arr, key) { const seen = new Set(); return arr.filter((x) => (seen.has(key(x)) ? false : seen.add(key(x)))); }

// ---------- 3. RLS policies + dynamic SQL ----------
function migrationFiles(root) {
  return ["supabase/migrations", "supabase/schemas", "db/migrations", "migrations", "prisma/migrations"]
    .map((d) => path.join(root, d)).filter((d) => fs.existsSync(d))
    .flatMap((d) => walk(d)).filter((f) => f.endsWith(".sql")).sort();
}
function balanced(s, openIdx) {
  // s[openIdx] === "(" → returns inner text up to the matching ")"
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") { depth--; if (depth === 0) return s.slice(openIdx + 1, i); }
  }
  return s.slice(openIdx + 1);
}
const policies = [];
const tables = {}; // name -> { columns:Set, rls, file }
const views = [];
const functions = [];
const sqlDynamic = [];
const sqlRoots = roots.map((r) => ({ ...r, files: migrationFiles(r.dir) })).filter((r) => r.files.length);
for (const r of sqlRoots) {
  for (const file of r.files) {
    const raw = readText(file) ?? "";
    const where = (idx) => `${r.name === "api" ? "api:" : ""}${rel(r.dir, file)}:${lineOf(raw, idx)}`;
    // function bodies first (dynamic SQL, definer checks), then mask them so statement splitting is safe
    for (const m of raw.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(([^)]*)\)([\s\S]*?)as\s+(\$\w*\$)([\s\S]*?)\4([^;]*);/gi)) {
      const name = m[1].replace(/"/g, "");
      const head = (m[3] + " " + m[6]).toLowerCase();
      const body = m[5];
      const definer = /security\s+definer/.test(head);
      functions.push({
        fn: name, at: where(m.index), securityDefiner: definer,
        trigger: /returns\s+(trigger|event_trigger)/.test(head),
        exposedSchema: !name.includes(".") || /^(public|api)\./i.test(name),
        searchPathSet: /set\s+search_path/.test(head),
        checksCaller: /auth\.(uid|jwt|role)\s*\(|current_user|session_user|request\.jwt|\b(current|is|has|can|require|assert|ensure|check)_\w+\s*\(/i.test(body),
      });
      for (const e of body.matchAll(/execute\s+([\s\S]*?);/gi)) {
        const stmt = e[1];
        const concat = /\|\|/.test(stmt);
        const fmtS = /format\s*\(\s*'[^']*%s/i.test(stmt);
        if (concat || fmtS) {
          sqlDynamic.push({ fn: name, at: where(m.index + m[0].indexOf(e[0])), kind: concat ? "execute-concat" : "format-%s", securityDefiner: definer, snippet: redact(stmt.replace(/\s+/g, " ").slice(0, 140)) });
        }
      }
    }
    const masked = raw.replace(/(\$\w*\$)[\s\S]*?\1/g, (s) => s.replace(/;/g, " "));
    let offset = 0;
    for (const stmt of masked.split(";")) {
      const start = offset; offset += stmt.length + 1;
      const s = stmt.trim();
      const low = s.toLowerCase();
      const idx = start + stmt.indexOf(s);
      let m;
      if ((m = low.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/))) {
        const schema = m[1] ?? "public";
        if (schema !== "public") continue;
        const t = (tables[m[2]] ??= { columns: new Set(), rls: false, at: where(idx) });
        const inner = balanced(low, low.indexOf("("));
        for (const col of inner.split(",")) { const c = col.trim().match(/^"?(\w+)"?\s+\w/); if (c && !/^(constraint|primary|unique|foreign|check)$/.test(c[1])) t.columns.add(c[1]); }
      } else if ((m = low.match(/^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s+(enable|disable)\s+row\s+level\s+security/))) {
        if ((m[1] ?? "public") === "public") (tables[m[2]] ??= { columns: new Set(), rls: false, at: null }).rls = m[3] === "enable";
      } else if ((m = low.match(/^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/))) {
        if ((m[1] ?? "public") === "public") (tables[m[2]] ??= { columns: new Set(), rls: false, at: null }).columns.add(m[3]);
      } else if ((m = low.match(/^create\s+(?:or\s+replace\s+)?view\s+(?:"?(\w+)"?\.)?"?(\w+)"?([\s\S]*?)\bas\b/))) {
        if ((m[1] ?? "public") === "public") views.push({ view: m[2], at: where(idx), securityInvoker: /security_invoker\s*=\s*(true|on)/.test(m[3]) });
      } else if ((m = s.match(/^create\s+policy\s+("[^"]+"|\w+)\s+on\s+(?:"?(\w+)"?\.)?"?(\w+)"?([\s\S]*)$/i))) {
        const rest = m[4];
        const restLow = rest.toLowerCase();
        const cmd = restLow.match(/\bfor\s+(all|select|insert|update|delete)\b/)?.[1] ?? "all";
        const rolesRaw = restLow.match(/\bto\s+([\w\s,"]+?)(?=\s+using\b|\s+with\s+check\b|$)/)?.[1];
        const roles = rolesRaw ? rolesRaw.split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean) : ["public"];
        const ui = restLow.search(/\busing\s*\(/);
        const ci = restLow.search(/\bwith\s+check\s*\(/);
        const usingExpr = ui >= 0 ? balanced(rest, rest.indexOf("(", ui)).replace(/\s+/g, " ").trim() : null;
        const checkExpr = ci >= 0 ? balanced(rest, rest.indexOf("(", ci)).replace(/\s+/g, " ").trim() : null;
        policies.push({
          table: `${(m[2] ?? "public").toLowerCase()}.${m[3].toLowerCase()}`, name: m[1].replace(/"/g, ""), command: cmd, roles,
          using: usingExpr ? usingExpr.slice(0, 220) : null, withCheck: checkExpr ? checkExpr.slice(0, 220) : null,
          permissive: !/as\s+restrictive/i.test(rest), usesAuthUid: /auth\.uid\s*\(/i.test(rest), at: where(idx),
        });
      }
    }
  }
}
// Functions whose EXECUTE was revoked from client roles are not callable as RPC.
const revoked = new Set();
for (const r of sqlRoots) for (const file of r.files) {
  for (const m of (readText(file) ?? "").matchAll(/revoke\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+([\w."]+)[^;]*?from\s+([^;]+);/gi)) {
    if (/\b(public|anon|authenticated)\b/i.test(m[2])) revoked.add(m[1].replace(/"/g, "").replace(/^public\./i, "").toLowerCase());
  }
}
// Later migrations may drop policies; keep it simple and flag by name only when a DROP for the same name/table exists.
const dropped = new Set();
for (const r of sqlRoots) for (const file of r.files) {
  for (const m of (readText(file) ?? "").matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|\w+)\s+on\s+(?:"?(\w+)"?\.)?"?(\w+)"?/gi)) {
    dropped.add(`${(m[2] ?? "public").toLowerCase()}.${m[3].toLowerCase()}|${m[1].replace(/"/g, "")}`);
  }
}
const livePolicies = policies.filter((p) => !dropped.has(`${p.table}|${p.name}`) || policies.filter((q) => q.table === p.table && q.name === p.name).at(-1) === p);
// A predicate "references the caller" when it uses auth.* / current_user or calls a helper function (e.g. is_member(org_id)).
const ID_REF = /auth\.(uid|jwt|role)\s*\(|current_user|\b(?!(?:now|lower|upper|coalesce|length|char_length|btrim|trim|array_length|cardinality|to_char|date_trunc|extract|split_part|left|right|substring|regexp_match|nullif|greatest|least)\s*\()[a-z_][\w.]*\s*\(/i;
const DENY = /^\(?\s*false\s*\)?$/i;
const TENANT_COLS = ["org_id", "organization_id", "tenant_id", "team_id", "workspace_id", "account_id", "company_id"];
const pred = (p) => [p.using, p.withCheck].filter(Boolean).join(" ").toLowerCase();
const writeCmd = (c) => ["insert", "update", "delete", "all"].includes(c);
const rlsIssues = {
  usingTrue: livePolicies.filter((p) => /^\(?\s*true\s*\)?$/.test(p.using ?? "") || /^\(?\s*true\s*\)?$/.test(p.withCheck ?? ""))
    .map((p) => ({ table: p.table, policy: p.name, command: p.command, roles: p.roles, at: p.at })),
  noCallerReference: livePolicies.filter((p) => (p.using || p.withCheck) && !ID_REF.test(pred(p)) && !/^\(?\s*true\s*\)?$/.test(p.using ?? "x") && !DENY.test(p.using ?? p.withCheck ?? ""))
    .map((p) => ({ table: p.table, policy: p.name, command: p.command, predicate: (p.using ?? p.withCheck).slice(0, 120), at: p.at })),
  authUidNotCompared: livePolicies.filter((p) => /auth\.uid\s*\(\s*\)\s*\)?\s*is\s+not\s+null/.test(pred(p)) && !/=\s*\(?\s*(select\s+)?auth\.uid|auth\.uid\s*\(\s*\)\s*\)?\s*=/.test(pred(p)))
    .map((p) => ({ table: p.table, policy: p.name, command: p.command, predicate: (p.using ?? p.withCheck).slice(0, 120), at: p.at })),
  insertWithoutCheck: livePolicies.filter((p) => (p.command === "insert") && !p.withCheck)
    .map((p) => ({ table: p.table, policy: p.name, at: p.at })),
  userMetadata: livePolicies.filter((p) => /user_metadata|raw_user_meta_data/.test(pred(p)))
    .map((p) => ({ table: p.table, policy: p.name, command: p.command, at: p.at })),
  publicOrAnonWrite: livePolicies.filter((p) => writeCmd(p.command) && p.roles.some((r) => r === "public" || r === "anon") && !ID_REF.test(pred(p)) && !DENY.test(p.using ?? p.withCheck ?? ""))
    .map((p) => ({ table: p.table, policy: p.name, command: p.command, roles: p.roles, at: p.at })),
  tenantColumnIgnored: Object.entries(tables).flatMap(([t, v]) => {
    const tcol = TENANT_COLS.find((c) => v.columns.has(c));
    if (!tcol) return [];
    const ps = livePolicies.filter((p) => p.table === `public.${t}`);
    if (!ps.length) return [];
    return ps.some((p) => pred(p).includes(tcol) || /\b\w+\s*\(/.test(pred(p).replace(/auth\.(uid|jwt|role)\s*\(/g, ""))) ? [] : [{ table: t, tenantColumn: tcol, policies: ps.length }];
  }),
  tablesWithoutRls: Object.entries(tables).filter(([, v]) => !v.rls).map(([t, v]) => ({ table: t, at: v.at })),
  tablesRlsNoPolicies: Object.entries(tables).filter(([t, v]) => v.rls && !livePolicies.some((p) => p.table === `public.${t}`)).map(([t]) => t),
  viewsWithoutSecurityInvoker: views.filter((v) => !v.securityInvoker),
  storagePolicies: livePolicies.filter((p) => p.table === "storage.objects")
    .map((p) => ({ policy: p.name, command: p.command, scopedToUser: /auth\.uid|foldername|owner/.test(pred(p)), at: p.at })),
  // Callable as RPC by clients: security definer, in an exposed schema, not a trigger, execute not revoked from client roles.
  definerRpcWithoutCallerCheck: functions.filter((f) => f.securityDefiner && f.exposedSchema && !f.trigger && !revoked.has(f.fn.replace(/^public\./, "").toLowerCase()) && !f.checksCaller)
    .map((f) => ({ fn: f.fn, searchPathSet: f.searchPathSet, at: f.at })),
  definerWithoutSearchPath: functions.filter((f) => f.securityDefiner && !f.searchPathSet).map((f) => ({ fn: f.fn, at: f.at })),
};
const commandsByTable = {};
for (const p of livePolicies) (commandsByTable[p.table] ??= new Set()).add(p.command);
const rls = sqlRoots.length ? {
  migrationFiles: sqlRoots.reduce((n, r) => n + r.files.length, 0),
  tables: Object.entries(tables).map(([t, v]) => ({
    table: t, rls: v.rls, policyCommands: [...(commandsByTable[`public.${t}`] ?? [])],
    tenantColumn: TENANT_COLS.find((c) => v.columns.has(c)) ?? null, ownerColumn: ["user_id", "owner_id", "created_by", "author_id", "profile_id"].find((c) => v.columns.has(c)) ?? null,
  })),
  policies: livePolicies,
  issues: rlsIssues,
  functions: { total: functions.length, securityDefiner: functions.filter((f) => f.securityDefiner).length },
  note: "Regex-parsed. Later migrations may change policies (ALTER POLICY, DROP + CREATE); read the newest migration for a table before reporting.",
} : null;

// ---------- 4. git history (opt-in) ----------
let gitHistorySecrets = { scanned: false, note: "Run with --history to scan git history for secrets and credential files (can take a while on large repos)." };
if (withHistory) {
  gitHistorySecrets = { scanned: true, findings: [], credentialFilesEverCommitted: [], roots: [] };
  const SECRET_RULE = RULES.find((r) => r.id === "secret-literal");
  const ERE = "sk_live_|rk_live_|AKIA[0-9A-Z]{16}|PRIVATE KEY-----|ghp_[0-9A-Za-z]{20}|xox[abpr]-|whsec_|sb_secret_|sk-[A-Za-z0-9_-]{32}|service_role|SERVICE_ROLE_KEY=";
  for (const r of roots) {
    if (!git(r.dir, ["rev-parse", "--is-inside-work-tree"])) { gitHistorySecrets.roots.push({ root: r.name, error: "not a git repo" }); continue; }
    const out = git(r.dir, ["log", "--all", "-p", "-U0", "--no-color", "--no-ext-diff", `--max-count=${maxCommits}`, "-E", `-G${ERE}`, "--format=@@commit %h %ad", "--date=short"], { maxBuffer: 256 * 1024 * 1024, timeout: 180_000 }) ?? "";
    const findings = [];
    let commit = null, file = null;
    for (const ln of out.split("\n")) {
      if (ln.startsWith("@@commit ")) { commit = ln.slice(9); continue; }
      if (ln.startsWith("+++ b/")) { file = ln.slice(6); continue; }
      if (!ln.startsWith("+") || ln.startsWith("+++")) continue;
      const added = ln.slice(1);
      if (SECRET_RULE.re.test(added) || /SERVICE_ROLE_KEY\s*=\s*\S{20,}|service_role['"]?\s*[:=]\s*['"]eyJ/.test(added)) {
        findings.push({ commit, file, sample: redact(added.trim()).slice(0, 140), stillInHead: file ? fs.existsSync(path.join(r.dir, file)) : null });
        if (findings.length >= 40) break;
      }
    }
    const credFiles = (git(r.dir, ["log", "--all", "--diff-filter=A", "--name-only", "--format=", `--max-count=${maxCommits * 5}`, "--", ".env", ".env.*", "*.env", "*.p8", "*.p12", "*.jks", "*.keystore", "*.pem", "service-account*.json", "credentials.json", "*.mobileprovision"]) ?? "")
      .split("\n").map((x) => x.trim()).filter((x) => x && !/\.(example|sample|template)$/.test(x));
    const cred = [...new Set(credFiles)].slice(0, 30).map((f) => ({ root: r.name, file: f, stillTracked: Boolean(git(r.dir, ["ls-files", "--error-unmatch", f])) }));
    gitHistorySecrets.findings.push(...findings.map((x) => ({ root: r.name, ...x })));
    gitHistorySecrets.credentialFilesEverCommitted.push(...cred);
    gitHistorySecrets.roots.push({ root: r.name, commitsScannedMax: maxCommits, findings: findings.length, truncated: findings.length >= 40 });
  }
  gitHistorySecrets.note = "Anything listed here is compromised even if deleted from HEAD: rotate the secret, then optionally purge history (git filter-repo).";
}

// ---------- 5. URL parameters ----------
const SENSITIVE_PARAM = /^(password|passwd|pwd|pass|email|e_?mail|phone|phone_?number|cnp|ssn|iban|card|card_?number|cvv|otp|pin|secret|api_?key|apikey|private_?key|access_token|refresh_token|token|jwt|session|code_verifier)$/i;
const params = {};
for (const f of files) {
  for (const m of f.text.matchAll(/[?&]([A-Za-z_][\w-]{0,40})=(?=[$'"`\w{])/g)) {
    // only inside a string/template literal on that line
    const lineStart = f.text.lastIndexOf("\n", m.index) + 1;
    const before = f.text.slice(lineStart, m.index);
    if (!/['"`]/.test(before)) continue;
    const key = `${f.root}|${m[1]}`;
    const p = (params[key] ??= { name: m[1], root: f.root, sensitive: SENSITIVE_PARAM.test(m[1]), count: 0, at: [] });
    p.count++;
    if (p.at.length < 3) p.at.push(loc(f, lineOf(f.text, m.index)));
  }
  for (const m of f.text.matchAll(/searchParams\.(set|append)\(\s*['"]([\w-]+)['"]/g)) {
    const key = `${f.root}|${m[2]}`;
    const p = (params[key] ??= { name: m[2], root: f.root, sensitive: SENSITIVE_PARAM.test(m[2]), count: 0, at: [] });
    p.count++;
    if (p.at.length < 3) p.at.push(loc(f, lineOf(f.text, m.index)));
  }
}
const allParams = Object.values(params).sort((a, b) => Number(b.sensitive) - Number(a.sensitive) || b.count - a.count);
const paramsFor = (root) => {
  const list = allParams.filter((p) => p.root === root).map(({ root: _r, ...p }) => p);
  const sens = list.filter((p) => p.sensitive);
  const rest = list.filter((p) => !p.sensitive);
  return summary ? [...sens, ...rest.slice(0, 15).map((p) => ({ name: p.name, sensitive: false, count: p.count }))] : [...sens, ...rest.slice(0, 100)];
};
const urlParams = { app: paramsFor("app"), api: apiRoot ? paramsFor("api") : [] };

// ---------- 6. web hardening (API repo, Expo API routes / web build) ----------
function webHardeningFor(r) {
  const cfgFiles = ["next.config.js", "next.config.mjs", "next.config.ts", "vercel.json", "middleware.ts", "src/middleware.ts", "proxy.ts", "src/proxy.ts", "netlify.toml", "_headers", "public/_headers"]
    .filter((x) => fs.existsSync(path.join(r.dir, x)));
  const text = cfgFiles.map((x) => readText(path.join(r.dir, x)) ?? "").join("\n") + "\n" + files.filter((f) => f.root === r.name && /(middleware|proxy|headers|security)/i.test(f.rel)).map((f) => f.text).join("\n");
  const routeText = files.filter((f) => f.root === r.name).map((f) => f.text).join("\n");
  const has = (re) => re.test(text);
  return {
    root: r.name,
    configFiles: cfgFiles,
    securityHeaders: {
      hsts: has(/Strict-Transport-Security/i), csp: has(/Content-Security-Policy/i), noSniff: has(/X-Content-Type-Options/i),
      frameProtection: has(/X-Frame-Options|frame-ancestors/i), referrerPolicy: has(/Referrer-Policy/i), permissionsPolicy: has(/Permissions-Policy/i),
    },
    cookies: {
      setsCookies: /cookies\(\)\.set|\.cookies\.set\(|Set-Cookie|setCookie\(/i.test(routeText),
      httpOnly: /httpOnly\s*:\s*true|HttpOnly/i.test(routeText), secure: /secure\s*:\s*true|;\s*Secure/i.test(routeText), sameSite: /sameSite\s*:|SameSite=/i.test(routeText),
    },
    csrfSignals: /csrf|xsrf|Origin['"]?\)?\s*(!==|===)|headers\.get\(\s*['"]origin['"]\s*\)|sec-fetch-site/i.test(routeText),
    cookieAuth: /@supabase\/ssr|createServerClient|getServerSession|next-auth|iron-session|lucia/i.test(routeText),
    corsWildcard: (routeText.match(/Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/g) ?? []).length,
  };
}
const webHardening = roots
  .filter((r) => r.name === "api" || files.some((f) => f.root === r.name && /\+api\.(t|j)sx?$|(^|\/)app\/api\//.test(f.rel)) || fs.existsSync(path.join(r.dir, "next.config.js")) || fs.existsSync(path.join(r.dir, "next.config.ts")) || fs.existsSync(path.join(r.dir, "next.config.mjs")))
  .map(webHardeningFor);

// ---------- 7. supply chain ----------
function supplyChainFor(r) {
  const pkg = readJson(path.join(r.dir, "package.json")) ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
  const devDeps = pkg.devDependencies ?? {};
  const lockfile = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"].find((x) => fs.existsSync(path.join(r.dir, x))) ?? null;
  const nonRegistry = Object.entries({ ...deps, ...devDeps })
    .filter(([, v]) => typeof v === "string" && /^(git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:)|\.tgz$|^[\w-]+\/[\w.-]+(#.*)?$/.test(v))
    .map(([name, spec]) => ({ name, spec: spec.replace(/(:\/\/)[^@/]+@/, "$1•••@") }));
  const nm = path.join(r.dir, "node_modules");
  const installScripts = [];
  if (fs.existsSync(nm)) {
    for (const name of Object.keys(deps)) {
      const p = readJson(path.join(nm, name, "package.json"));
      const s = p?.scripts ?? {};
      const hooks = ["preinstall", "install", "postinstall"].filter((k) => s[k]);
      if (hooks.length) installScripts.push({ name, hooks, command: hooks.map((k) => s[k]).join(" && ").slice(0, 120) });
    }
  }
  const patches = fs.existsSync(path.join(r.dir, "patches")) ? fs.readdirSync(path.join(r.dir, "patches")).filter((x) => x.endsWith(".patch")) : [];
  const ci = walk(path.join(r.dir, ".github")).map((x) => readText(x) ?? "").join("\n");
  return {
    root: r.name, lockfile, lockfileTracked: lockfile ? Boolean(git(r.dir, ["ls-files", "--error-unmatch", lockfile])) : false,
    directDependencies: Object.keys(deps).length, nonRegistryDependencies: nonRegistry,
    installScripts: fs.existsSync(nm) ? installScripts : "node_modules not present — not checked",
    patches, overrides: Boolean(pkg.overrides || pkg.resolutions || pkg.pnpm?.overrides),
    ci: { npmCi: /npm ci\b|pnpm install --frozen-lockfile|yarn install --(frozen-lockfile|immutable)|bun install --frozen-lockfile/.test(ci), auditGate: /npm audit|pnpm audit|yarn (npm )?audit|osv-scanner|snyk|socket/.test(ci) },
    hint: "Run `npm audit --omit=dev --audit-level=high` (ask first; needs network) for known CVEs.",
  };
}
const supplyChain = roots.map(supplyChainFor);

// ---------- 8. area overview ----------
const AREAS = ["secrets", "injection", "url-exposure", "access-control", "auth", "platform", "api-hardening", "data-exposure", "supply-chain"];
const areas = Object.fromEntries(AREAS.map((a) => [a, { ruleHits: 0, p0: 0, p1: 0, extra: [] }]));
for (const h of Object.values(hitsOut)) {
  const a = areas[h.area]; if (!a) continue;
  a.ruleHits += h.count; if (h.severity === "P0") a.p0 += h.count; if (h.severity === "P1") a.p1 += h.count;
}
const push = (area, n, label) => { if (n) areas[area].extra.push(`${label}: ${n}`); };
push("injection", sqlDynamic.length, "dynamic SQL in functions");
push("injection", inputSurfaces.length, "input surfaces to trace");
if (rls) {
  const i = rls.issues;
  push("access-control", i.tablesWithoutRls.length, "tables without RLS");
  push("access-control", i.usingTrue.length, "policies using (true)");
  push("access-control", i.authUidNotCompared.length, "policies with auth.uid() is not null only");
  push("access-control", i.noCallerReference.length, "policies not referencing the caller");
  push("access-control", i.publicOrAnonWrite.length, "write policies for public/anon");
  push("access-control", i.userMetadata.length, "policies trusting user_metadata");
  push("access-control", i.tenantColumnIgnored.length, "tables whose tenant column is ignored by policies");
  push("access-control", i.viewsWithoutSecurityInvoker.length, "views without security_invoker");
  push("access-control", i.definerRpcWithoutCallerCheck.length, "security definer RPCs (client-callable) without caller check");
}
if (gitHistorySecrets.scanned) push("secrets", gitHistorySecrets.findings.length + gitHistorySecrets.credentialFilesEverCommitted.length, "items in git history");
push("url-exposure", allParams.filter((p) => p.sensitive).length, "sensitive query parameter names");
for (const w of webHardening) {
  const missing = Object.entries(w.securityHeaders).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) areas["api-hardening"].extra.push(`${w.root}: missing headers ${missing.join(", ")}`);
}
for (const s of supplyChain) {
  if (!s.lockfile) areas["supply-chain"].extra.push(`${s.root}: no lockfile`);
  push("supply-chain", s.nonRegistryDependencies.length, `${s.root}: non-registry deps`);
  if (Array.isArray(s.installScripts)) push("supply-chain", s.installScripts.length, `${s.root}: deps with install scripts`);
}

// ---------- output ----------
const result = {
  tool: "expo-es-kit/security-scan",
  version: VERSION,
  generatedAt: new Date().toISOString(),
  appRoot, apiRoot,
  totals: { files: files.length, appFiles: files.filter((f) => f.root === "app").length, apiFiles: files.filter((f) => f.root === "api").length },
  stack: (() => {
    const pkg = readJson(path.join(appRoot, "package.json"));
    const apk = apiRoot ? readJson(path.join(apiRoot, "package.json")) : null;
    const any = (n) => verOf(pkg, n) ?? verOf(apk, n);
    return { expo: verOf(pkg, "expo"), supabase: any("@supabase/supabase-js"), next: verOf(apk, "next") ?? verOf(pkg, "next"), prisma: any("@prisma/client"), pg: any("pg") ?? any("postgres"), drizzle: any("drizzle-orm"), expoSqlite: verOf(pkg, "expo-sqlite"), webview: verOf(pkg, "react-native-webview") };
  })(),
  areas,
  hits: hitsOut,
  inputSurfaces: summary ? inputSurfaces.slice(0, 20).map((s) => ({ file: s.file, inputs: s.inputs.map((i) => i.label ?? i.kind).slice(0, 6), sinks: s.sinks.map((x) => x.sink).slice(0, 8) })) : inputSurfaces.slice(0, 80),
  inputSurfacesTotal: inputSurfaces.length,
  rls: rls && summary ? { ...rls, policies: `${rls.policies.length} policies (see full scan)`, tables: rls.tables.length > 40 ? `${rls.tables.length} tables (see full scan)` : rls.tables } : rls,
  sqlDynamic,
  gitHistorySecrets,
  urlParams,
  webHardening,
  supplyChain,
  note: "Signals only. Read the code (and shared wrappers, middleware, later migrations) before reporting a finding.",
};
if (summary) {
  result.summary = true;
  for (const h of Object.values(result.hits)) h.samples = h.samples.slice(0, 2);
  if (result.rls?.issues) for (const [k, v] of Object.entries(result.rls.issues)) if (Array.isArray(v) && v.length > 12) result.rls.issues[k] = [...v.slice(0, 12), `… +${v.length - 12} more (see full scan)`];
}
process.stdout.write(JSON.stringify(result, null, pretty ? 2 : 0) + "\n");
