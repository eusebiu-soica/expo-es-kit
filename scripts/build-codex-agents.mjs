#!/usr/bin/env node
// Generate Codex custom agents (TOML) from agents/*.md, so deep modes can use subagents in Codex too.
// Usage: node scripts/build-codex-agents.mjs [--check]
//   writes codex/agents/<name>.toml (copy them to ~/.codex/agents/ or <repo>/.codex/agents/)
//   --check: exit 1 if any generated file is missing or out of date (used by validate-plugin.mjs)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "agents");
const outDir = path.join(root, "codex", "agents");
const check = process.argv.includes("--check");

function parse(md) {
  const m = md.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"')) { try { v = JSON.parse(v); } catch {} }
    fm[kv[1]] = v;
  }
  return { fm, body: m[2].trim() };
}
const tomlString = (s) => JSON.stringify(s); // JSON string escapes are valid TOML basic-string escapes
function tomlMultiline(s) {
  // Literal multi-line string keeps backslashes and backticks as-is; fall back to an escaped basic string.
  return s.includes("'''") ? tomlString(s) : `'''\n${s}\n'''`;
}

const PREAMBLE = "PLUGIN_ROOT is the expo-es-kit plugin folder (the orchestrator passes it in the prompt; otherwise find it with `find ~/.codex ~/.agents ~/.claude/plugins -type f -path '*expo-es-kit*/scripts/scan.mjs'` and strip `/scripts/scan.mjs`). Paths below are relative to it.\n\n";

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md")).sort();
let stale = [];
fs.mkdirSync(outDir, { recursive: true });
for (const f of files) {
  const parsed = parse(fs.readFileSync(path.join(srcDir, f), "utf8"));
  if (!parsed?.fm.name) { console.error(`skip ${f}: no frontmatter name`); continue; }
  const { fm, body } = parsed;
  const toml = [
    `# Generated from agents/${f} by scripts/build-codex-agents.mjs — do not edit by hand.`,
    `name = ${tomlString(fm.name)}`,
    `description = ${tomlString(fm.description ?? "")}`,
    `sandbox_mode = "read-only"`,
    `developer_instructions = ${tomlMultiline(PREAMBLE + body)}`,
    "",
  ].join("\n");
  const out = path.join(outDir, `${fm.name}.toml`);
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
  if (current !== toml) {
    if (check) stale.push(path.relative(root, out));
    else fs.writeFileSync(out, toml);
  }
}
if (check) {
  if (stale.length) { console.log(JSON.stringify({ ok: false, stale })); process.exit(1); }
  console.log(JSON.stringify({ ok: true, agents: files.length }));
} else {
  console.log(JSON.stringify({ ok: true, written: path.relative(root, outDir), agents: files.length }));
}
