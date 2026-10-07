#!/usr/bin/env node
// Compare two full scans (before/after a fix run). Reports per-rule count deltas and NEW guard-rule
// hits in the changed files. Usage: node diff-scans.mjs <before.json> <after.json> [--changed=a.ts,b.tsx]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [beforeF, afterF, ...rest] = process.argv.slice(2);
const changedArg = rest.find((a) => a.startsWith("--changed="));
const changed = changedArg ? new Set(changedArg.slice(10).split(",").filter(Boolean)) : null;
const before = JSON.parse(fs.readFileSync(beforeF, "utf8"));
const after = JSON.parse(fs.readFileSync(afterF, "utf8"));
const { RULES, FILE_RULES } = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), "rules.mjs"));
const meta = Object.fromEntries([...RULES, ...FILE_RULES].map((r) => [r.id, r]));

const ids = new Set([...Object.keys(before.hits ?? {}), ...Object.keys(after.hits ?? {})]);
const deltas = [];
for (const id of ids) {
  const b = before.hits?.[id]?.count ?? 0;
  const a = after.hits?.[id]?.count ?? 0;
  if (a !== b) deltas.push({ id, category: meta[id]?.category ?? "?", severity: meta[id]?.severity ?? null, before: b, after: a, delta: a - b });
}
deltas.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

const key = (s) => `${s.file}:${s.text}`;
const newRiskHits = [];
for (const id of Object.keys(after.hits ?? {})) {
  const r = meta[id];
  if (!r || !(r.guard || r.severity === "P0" || r.severity === "P1")) continue;
  const old = new Set((before.hits?.[id]?.samples ?? []).map(key));
  for (const s of after.hits[id].samples) {
    if (old.has(key(s))) continue;
    if (changed && !changed.has(s.file)) continue;
    newRiskHits.push({ id, severity: r.severity ?? "P2", file: s.file, line: s.line, text: s.text });
  }
}
console.log(JSON.stringify({
  ruleDeltas: deltas,
  improved: deltas.filter((d) => d.delta < 0 && d.severity).length,
  worsened: deltas.filter((d) => d.delta > 0 && d.severity).length,
  newRiskHits,
  verdict: newRiskHits.some((h) => h.severity === "P0" || h.severity === "P1") ? "INVESTIGATE: new P0/P1 signals" : "no new P0/P1 signals",
}, null, 2));
