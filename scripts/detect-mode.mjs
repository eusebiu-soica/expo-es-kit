#!/usr/bin/env node
// Prints only the backend-mode part of the scan: { mode, signals, apiFrameworks }.
// Usage: node detect-mode.mjs <appRoot> [--api=<apiRoot>]
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = execFileSync(process.execPath, [path.join(here, "scan.mjs"), ...process.argv.slice(2)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const scan = JSON.parse(out);
if (scan.error) { console.log(JSON.stringify(scan)); process.exit(1); }
const frameworks = [...new Set([...(scan.api?.frameworks ?? []), ...(scan.appApiRoutes?.frameworks ?? [])])];
console.log(JSON.stringify({ ...scan.backend, apiFrameworks: frameworks, supabase: Boolean(scan.stack.libs["@supabase/supabase-js"]) }, null, 2));
