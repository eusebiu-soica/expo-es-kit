// Shared, zero-dependency helpers for the expo-es-kit scanners (scan.mjs, security-scan.mjs).
// Read-only: nothing here writes to disk.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".expo", ".expo-shared", "dist", "build", "web-build", "coverage",
  "ios", "android", ".next", ".vercel", ".turbo", ".cache", "Pods", "vendor", "__generated__",
  "test-output", ".claude", ".cursor", ".agents", "docs",
]);

export function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
export function readText(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}
export function rel(root, p) { return path.relative(root, p).split(path.sep).join("/"); }
export function walk(root, out = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".env" && !e.name.startsWith(".env") && e.isDirectory()) {
      if (![".github", ".eas"].includes(e.name)) continue;
    }
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}
export function git(root, gitArgs, opts = {}) {
  try {
    return execFileSync("git", ["-C", root, ...gitArgs], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024, timeout: opts.timeout,
    });
  } catch { return null; }
}
export function verOf(pkg, name) {
  return pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name] ?? null;
}
export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}
