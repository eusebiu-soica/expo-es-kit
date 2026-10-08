#!/usr/bin/env node
// expo-es-kit PostToolUse guard — warn-only. Never blocks, never throws, exits 0.
// Checks only the text that was just written, and only inside projects whose package.json depends on "expo".
// Disable per project with EXPO_ES_KIT_GUARD=off, or a `.expo-es-kit.json` containing {"guard": false}.
//
// Input shapes understood:
//   Claude Code / Codex  Write {file_path, content} · Edit {file_path, new_string} · MultiEdit {file_path, edits[]}
//   Codex apply_patch    {patch|input|command: "*** Begin Patch\n*** Update File: a.ts\n+added line…"}
//   Cursor (--format=cursor) postToolUse {tool_input: {file_path|path, content|contents|new_string…}}
// Output: Claude/Codex → {hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext}}; Cursor → {additional_context}.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const CURSOR = process.argv.includes("--format=cursor");

function done(msg) {
  if (msg) {
    process.stdout.write(JSON.stringify(CURSOR
      ? { additional_context: msg }
      : { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } }));
  }
  process.exit(0);
}

function findExpoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj)) {
      try {
        const p = JSON.parse(fs.readFileSync(pj, "utf8"));
        if (p.dependencies?.expo || p.devDependencies?.expo) return dir;
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Returns [{ file, text }] — the files touched and only the text that was written to each.
function writtenChunks(input) {
  const ti = input.tool_input ?? input.toolInput ?? {};
  const patch = [ti.patch, ti.input, typeof ti.command === "string" ? ti.command : null, Array.isArray(ti.command) ? ti.command.join("\n") : null]
    .find((x) => typeof x === "string" && x.includes("*** Begin Patch"));
  if (patch) {
    const byFile = new Map();
    let cur = null;
    for (const ln of patch.split("\n")) {
      const m = ln.match(/^\*\*\* (?:Add|Update) File: (.+)$/);
      if (m) { cur = m[1].trim(); byFile.set(cur, byFile.get(cur) ?? []); continue; }
      if (/^\*\*\* (Delete File|End Patch|Move to)/.test(ln)) { if (!/Move to/.test(ln)) cur = null; continue; }
      if (cur && ln.startsWith("+")) byFile.get(cur).push(ln.slice(1));
    }
    return [...byFile].map(([file, lines]) => ({ file, text: lines.join("\n") }));
  }
  const file = ti.file_path ?? ti.path ?? ti.filePath ?? ti.target_file ?? input.file_path;
  const text = [ti.content, ti.contents, ti.new_string, ti.newString, ti.code_edit,
    ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e.new_string ?? e.newString) : [])]
    .filter((x) => typeof x === "string").join("\n");
  return file ? [{ file, text }] : [];
}

async function main() {
  if (process.env.EXPO_ES_KIT_GUARD === "off") done();
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw || "{}");
  const cwd = input.cwd ?? (Array.isArray(input.workspace_roots) ? input.workspace_roots[0] : null) ?? process.cwd();
  const chunks = writtenChunks(input).filter((c) => EXT.has(path.extname(c.file)) && c.text.trim());
  if (!chunks.length) done();

  const { GUARD_RULES } = await import(path.join(here, "..", "scripts", "rules.mjs"));
  const out = [];
  for (const { file, text } of chunks) {
    const abs = path.resolve(cwd, file);
    const root = findExpoRoot(path.dirname(abs));
    if (!root) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(root, ".expo-es-kit.json"), "utf8"));
      if (cfg.guard === false) continue;
    } catch {}
    const relFile = path.relative(root, abs).split(path.sep).join("/");
    const ctx = { file: relFile, ext: path.extname(file), text };
    const lines = text.split("\n");
    const warnings = [];
    for (const rule of GUARD_RULES) {
      if (rule.scope && !rule.scope(ctx)) continue;
      const idx = lines.findIndex((l) => rule.re.test(l) && !(rule.not && rule.not.test(l)));
      if (idx >= 0) warnings.push(`- [${rule.severity ?? "P2"} ${rule.id}] ${rule.message} (in the text you just wrote: \`${lines[idx].trim().slice(0, 100)}\`)`);
    }
    if (warnings.length) out.push(`${relFile}:\n${warnings.join("\n")}`);
  }
  if (!out.length) done();
  done(`expo-es-kit guard — review before continuing:\n${out.join("\n")}\nIf this is intentional and safe (e.g. a server-only file), keep it and say why.`);
}

main().catch(() => done());
