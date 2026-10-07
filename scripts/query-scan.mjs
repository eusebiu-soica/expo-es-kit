#!/usr/bin/env node
// Query a full scan JSON without loading it all into context.
// Usage:
//   node query-scan.mjs <scan.json> hits <ruleId> [ruleId...]   → all samples for these rules
//   node query-scan.mjs <scan.json> path <dot.path>             → e.g. api.routesWithoutAuthSignal, config.eas
//   node query-scan.mjs <scan.json> category <categoryId>       → hit counts for rules of one category
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [file, cmd, ...rest] = process.argv.slice(2);
if (!file || !cmd) { console.error("usage: query-scan.mjs <scan.json> hits|path|category <args>"); process.exit(1); }
const scan = JSON.parse(fs.readFileSync(file, "utf8"));
if (cmd === "hits") {
  console.log(JSON.stringify(Object.fromEntries(rest.map((id) => [id, scan.hits[id] ?? { count: 0 }])), null, 2));
} else if (cmd === "path") {
  const v = rest[0].split(".").reduce((o, k) => (o == null ? o : o[k]), scan);
  console.log(JSON.stringify(v ?? null, null, 2));
} else if (cmd === "category") {
  const { RULES, FILE_RULES } = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), "rules.mjs"));
  const ids = [...RULES, ...FILE_RULES].filter((r) => r.category === rest[0]).map((r) => r.id);
  console.log(JSON.stringify(Object.fromEntries(ids.map((id) => [id, scan.hits[id] ? { count: scan.hits[id].count, fileCount: scan.hits[id].fileCount } : 0])), null, 2));
} else { console.error("unknown command"); process.exit(1); }
