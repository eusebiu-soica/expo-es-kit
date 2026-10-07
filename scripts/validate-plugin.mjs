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

for (const f of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "hooks/hooks.json"]) {
  try { JSON.parse(read(f)); } catch (e) { errors.push(`${f}: invalid JSON (${e.message})`); }
}
const pj = JSON.parse(read(".claude-plugin/plugin.json"));
const mj = JSON.parse(read(".claude-plugin/marketplace.json"));
if (mj.plugins?.[0]?.version !== pj.version) errors.push("marketplace.json plugin version != plugin.json version");

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}
const skills = fs.readdirSync(path.join(root, "skills"));
for (const s of skills) {
  const p = `skills/${s}/SKILL.md`;
  if (!exists(p)) { errors.push(`${p} missing`); continue; }
  const fm = frontmatter(read(p));
  if (!fm || !/^name:\s*\S/m.test(fm) || !/^description:\s*\S/m.test(fm)) errors.push(`${p}: frontmatter needs name + description`);
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
    if (["audit", "fix", "setup", "backend", "foundation", "heroui", "start", "end"].includes(n)) continue;
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

console.log(`skills: ${skills.length}, agents: ${agents.length}, rules: ${RULES.length} (guard: ${GUARD_RULES.length}), md files: ${mdFiles.length}`);
for (const w of warn) console.log("WARN  " + w);
for (const e of errors) console.log("ERROR " + e);
console.log(errors.length ? `✗ ${errors.length} error(s)` : "✓ plugin structure OK");
process.exit(errors.length ? 1 : 0);
