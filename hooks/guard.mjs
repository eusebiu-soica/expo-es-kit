#!/usr/bin/env node
// expo-es-kit PostToolUse guard — warn-only. Never blocks, never throws, exits 0.
// Checks only the text that was just written (Write content / Edit new_string / MultiEdit edits),
// and only inside projects whose package.json depends on "expo".
// Disable per project with EXPO_ES_KIT_GUARD=off, or a `.expo-es-kit.json` containing {"guard": false}.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function done(msg) {
  if (msg) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg },
    }));
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

async function main() {
  if (process.env.EXPO_ES_KIT_GUARD === "off") done();
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw || "{}");
  const ti = input.tool_input ?? {};
  const file = ti.file_path;
  if (!file || !EXT.has(path.extname(file))) done();
  const root = findExpoRoot(path.dirname(path.resolve(input.cwd ?? ".", file)));
  if (!root) done();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, ".expo-es-kit.json"), "utf8"));
    if (cfg.guard === false) done();
  } catch {}

  const written = [ti.content, ti.new_string, ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e.new_string) : [])]
    .filter((x) => typeof x === "string").join("\n");
  if (!written.trim()) done();

  const { GUARD_RULES } = await import(path.join(here, "..", "scripts", "rules.mjs"));
  const relFile = path.relative(root, path.resolve(input.cwd ?? ".", file)).split(path.sep).join("/");
  const ctx = { file: relFile, ext: path.extname(file), text: written };
  const lines = written.split("\n");
  const warnings = [];
  for (const rule of GUARD_RULES) {
    if (rule.scope && !rule.scope(ctx)) continue;
    const idx = lines.findIndex((l) => rule.re.test(l) && !(rule.not && rule.not.test(l)));
    if (idx >= 0) warnings.push(`- [${rule.severity ?? "P2"} ${rule.id}] ${rule.message} (in the text you just wrote: \`${lines[idx].trim().slice(0, 100)}\`)`);
  }
  if (!warnings.length) done();
  done(`expo-es-kit guard — review before continuing (${relFile}):\n${warnings.join("\n")}\nIf this is intentional and safe (e.g. a server-only file), keep it and say why.`);
}

main().catch(() => done());
