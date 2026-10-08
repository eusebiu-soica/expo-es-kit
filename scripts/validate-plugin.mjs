#!/usr/bin/env node
// Self-check for the plugin: manifests parse, skills/agents have frontmatter, every
// `PLUGIN_ROOT/...` / `references/...` / `templates/...` path mentioned in skills and agents exists,
// and rules.mjs regexes compile. Usage: node scripts/validate-plugin.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warn = [];
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

const MANIFESTS = [
  ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "hooks/hooks.json",
  ".codex-plugin/plugin.json", ".agents/plugins/marketplace.json",
  ".cursor-plugin/plugin.json", ".cursor-plugin/marketplace.json", "hooks/cursor-hooks.json",
];
const J = {};
for (const f of MANIFESTS) {
  if (!exists(f)) { errors.push(`${f}: missing`); continue; }
  try { J[f] = JSON.parse(read(f)); } catch (e) { errors.push(`${f}: invalid JSON (${e.message})`); }
}
const pj = J[".claude-plugin/plugin.json"] ?? {};
// One version everywhere (Claude Code, Codex, Cursor).
const versions = {
  "claude plugin.json": pj.version,
  "claude marketplace.json": J[".claude-plugin/marketplace.json"]?.plugins?.[0]?.version,
  "codex plugin.json": J[".codex-plugin/plugin.json"]?.version,
  "cursor plugin.json": J[".cursor-plugin/plugin.json"]?.version,
  "cursor marketplace.json": J[".cursor-plugin/marketplace.json"]?.plugins?.[0]?.version,
};
for (const [k, v] of Object.entries(versions)) if (v !== pj.version) errors.push(`${k} version ${v} != ${pj.version}`);
for (const [f, j] of Object.entries(J)) if (j.name && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(j.name)) errors.push(`${f}: name must be lowercase kebab-case`);
// Cursor manifest paths must exist (a set path replaces default discovery).
const cur = J[".cursor-plugin/plugin.json"] ?? {};
// Cursor submission checklist: paths are relative, no "..", and exist.
for (const k of ["skills", "agents", "rules", "commands", "hooks", "logo"]) {
  for (const v of [cur[k]].flat().filter((x) => typeof x === "string")) {
    if (/^\/|^[a-zA-Z]:|(^|\/)\.\.(\/|$)/.test(v)) errors.push(`.cursor-plugin/plugin.json: ${k} path ${v} must be relative, without ".."`);
    else if (!exists(v)) errors.push(`.cursor-plugin/plugin.json: ${k} path ${v} does not exist`);
  }
}
const cx = J[".codex-plugin/plugin.json"] ?? {};
if (typeof cx.skills === "string" && !exists(cx.skills)) errors.push(`.codex-plugin/plugin.json: skills path ${cx.skills} does not exist`);
for (const e of J[".agents/plugins/marketplace.json"]?.plugins ?? []) {
  if (!e.policy?.installation || !e.policy?.authentication || !e.category) errors.push(".agents/plugins/marketplace.json: each plugin needs policy.installation, policy.authentication and category");
}

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}
// YAML pitfalls that make Claude Code drop the whole frontmatter: CRLF, and unquoted plain scalars containing ": " or " #".
function yamlProblems(file, text) {
  const out = [];
  if (text.charCodeAt(0) === 0xfeff) out.push(`${file}: starts with a UTF-8 BOM (Codex drops the skill) — remove it`);
  if (text.includes("\r")) out.push(`${file}: CRLF line endings (frontmatter will not parse) — normalize to LF`);
  const fm = frontmatter(text.replace(/\r/g, ""));
  if (!fm) return out;
  for (const line of fm.split("\n")) {
    const m = line.match(/^([\w-]+):\s+(.*)$/);
    if (!m) continue;
    const v = m[2].trim();
    if (/^["'>|\[{]/.test(v)) continue;
    if (/:\s/.test(v) || /\s#/.test(v)) out.push(`${file}: frontmatter "${m[1]}" has an unquoted ": " or " #" — wrap the value in double quotes`);
  }
  return out;
}
const skills = fs.readdirSync(path.join(root, "skills"));
for (const f of [...fs.readdirSync(path.join(root, "skills")).map((x) => `skills/${x}/SKILL.md`), ...fs.readdirSync(path.join(root, "agents")).map((x) => `agents/${x}`)]) {
  if (exists(f)) errors.push(...yamlProblems(f, read(f)));
}
for (const s of skills) {
  const p = `skills/${s}/SKILL.md`;
  if (!exists(p)) { errors.push(`${p} missing`); continue; }
  const fm = frontmatter(read(p));
  if (!fm || !/^name:\s*\S/m.test(fm) || !/^description:\s*\S/m.test(fm)) { errors.push(`${p}: frontmatter needs name + description`); continue; }
  // Agent Skills standard (Codex, Cursor): name == folder, a-z0-9-, ≤64; description ≤1024 (≤500 to be safe in Codex).
  const name = fm.match(/^name:\s*"?([^"\n]+)"?/m)[1].trim();
  if (name !== s) errors.push(`${p}: name "${name}" must match the folder name "${s}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) errors.push(`${p}: name must be 1-64 chars of a-z0-9 and single hyphens`);
  let desc = fm.match(/^description:\s*(.*)$/m)[1].trim();
  try { if (desc.startsWith('"')) desc = JSON.parse(desc); } catch {}
  if (desc.length > 1024) errors.push(`${p}: description is ${desc.length} chars (max 1024)`);
  else if (desc.length > 500) errors.push(`${p}: description is ${desc.length} chars — keep it ≤500 for Codex`);
}
const agents = fs.readdirSync(path.join(root, "agents"));
for (const a of agents) {
  const fm = frontmatter(read(`agents/${a}`));
  if (!fm || !/^name:\s*\S/m.test(fm) || !/^description:\s*\S/m.test(fm) || !/^tools:/m.test(fm)) errors.push(`agents/${a}: frontmatter needs name, description, tools`);
}

// referenced paths
const docFiles = [...skills.map((s) => `skills/${s}/SKILL.md`), ...agents.map((a) => `agents/${a}`)];
for (const f of docFiles) {
  const text = read(f);
  const base = path.dirname(f);
  const refs = new Set();
  for (const m of text.matchAll(/PLUGIN_ROOT\/([\w./-]+\.(?:md|mjs|ts|tsx|json))/g)) refs.add(m[1]);
  for (const m of text.matchAll(/`((?:skills|agents|shared|scripts|hooks)\/[\w./<>-]+\.(?:md|mjs|ts|tsx))`/g)) refs.add(m[1]);
  for (const m of text.matchAll(/`((?:references|templates)\/[\w./-]+\.(?:md|ts|tsx))`/g)) refs.add(path.join(base, m[1]));
  for (const r of refs) {
    if (r.includes("<")) continue;
    if (!exists(r)) errors.push(`${f}: references missing file ${r}`);
  }
}

// subagent types referenced in skills exist
for (const s of skills) {
  for (const m of read(`skills/${s}/SKILL.md`).matchAll(/expo-es-kit:([a-z-]+)/g)) {
    const n = m[1];
    if ([...skills, "start", "end"].includes(n)) continue;
    if (!agents.includes(`${n}.md`)) errors.push(`skills/${s}: unknown agent expo-es-kit:${n}`);
  }
}

// rules compile + guard rules have messages
const { RULES, GUARD_RULES } = await import(path.join(root, "scripts/rules.mjs"));
const ids = new Set();
for (const r of RULES) {
  if (ids.has(r.id)) errors.push(`rules.mjs: duplicate id ${r.id}`);
  ids.add(r.id);
  if (!(r.re instanceof RegExp)) errors.push(`rules.mjs: ${r.id} has no regex`);
}
for (const r of GUARD_RULES) if (!r.message) errors.push(`rules.mjs: guard rule ${r.id} needs a message`);

// hit ids mentioned in docs exist in rules
const allRuleIds = new Set([...RULES.map((r) => r.id), ...(await import(path.join(root, "scripts/rules.mjs"))).FILE_RULES.map((r) => r.id)]);
const mdFiles = [];
const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (p.endsWith(".md")) mdFiles.push(p); } };
["skills", "agents", "shared"].forEach(walk);
for (const f of mdFiles) {
  for (const m of read(f).matchAll(/hits\[["']([\w-]+)["']\]/g)) if (!allRuleIds.has(m[1])) warn.push(`${f}: hits["${m[1]}"] is not a rule id`);
}

// "Signals:" lines in references cite rule ids in backticks — they must exist.
for (const f of mdFiles) {
  for (const line of read(f).split("\n").filter((l) => l.startsWith("**Signals:**"))) {
    for (const m of line.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)) {
      if (!allRuleIds.has(m[1]) && !/^(expo|react|supabase|next|heroui|patch|eas|app|use|lib)-|^[a-z]+-(id|key)$|^(merge-deep|jail-monkey|deep-merge|lodash-\w+)$/.test(m[1])) warn.push(`${f}: Signals cites \`${m[1]}\`, which is not a rule id`);
    }
  }
}

// Codex agents (TOML) generated from agents/*.md must be up to date.
try {
  (await import("node:child_process")).execFileSync(process.execPath, [path.join(root, "scripts/build-codex-agents.mjs"), "--check"], { stdio: "pipe" });
} catch (e) {
  errors.push(`codex/agents is out of date — run node scripts/build-codex-agents.mjs (${String(e.stdout ?? "").trim()})`);
}

console.log(`skills: ${skills.length}, agents: ${agents.length}, rules: ${RULES.length} (guard: ${GUARD_RULES.length}), md files: ${mdFiles.length}`);
for (const w of warn) console.log("WARN  " + w);
for (const e of errors) console.log("ERROR " + e);
console.log(errors.length ? `✗ ${errors.length} error(s)` : "✓ plugin structure OK");
process.exit(errors.length ? 1 : 0);
