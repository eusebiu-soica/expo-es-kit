#!/usr/bin/env node
// Build a self-contained audit history page + score badge from docs/audits/*.json.
// Usage: node history.mjs <appRoot> [--dir=docs/audits] [--out=<dir>/history.html]
// Writes: <out>, <dir>/badge.svg, <dir>/badge.json (shields.io endpoint format), and badge-security.{svg,json}
// when security-audit reports exist. No network, no deps.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const appRoot = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dir = path.resolve(appRoot, opt("dir", "docs/audits"));
const out = path.resolve(appRoot, opt("out", path.join(dir, "history.html")));

const CATEGORIES = [
  ["perf", "Performance"], ["startup", "Startup speed"], ["bundle", "Bundle size"], ["caching", "Caching"],
  ["mmkv", "MMKV"], ["secure-storage", "Secure storage"], ["client-security", "Client security"],
  ["auth-sessions", "Auth & sessions"], ["backend", "Backend security"], ["deps", "Dependencies"],
  ["updates", "Updates"], ["release", "Release readiness"], ["agent-config", "Agent instructions"], ["heroui", "HeroUI Native"],
];

if (!fs.existsSync(dir)) {
  console.log(JSON.stringify({ error: `No audits folder at ${dir}. Run /expo-es-kit:audit first.` }));
  process.exit(1);
}

const reports = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("badge"))) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (j.tool !== "expo-es-kit") continue;
    reports.push({ file: f, ...j });
  } catch { /* ignore non-report JSON */ }
}
const sortKey = (r) => `${r.date ?? ""}|${String(r.file.match(/-(\d+)\.json$/)?.[1] ?? "1").padStart(3, "0")}|${r.file}`;
reports.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

const audits = reports.filter((r) => r.type === "audit");
const fixes = reports.filter((r) => r.type === "fix");
const secAudits = reports.filter((r) => r.type === "security-audit");
if (!audits.length && !secAudits.length) {
  console.log(JSON.stringify({ error: `No expo-es-kit audit or security-audit JSON in ${dir}.` }));
  process.exit(1);
}
// The main series is the production-readiness audit; with only security audits, those become the main series.
const base = audits.length ? audits : secAudits;

function counts(r) {
  const c = { P0: 0, P1: 0, P2: 0 };
  const groups = r.type === "security-audit" && Array.isArray(r.areas) ? r.areas : r.categories ?? [];
  for (const cat of groups) for (const f of cat.findings ?? []) {
    if (f.status && f.status !== "open" && f.status !== "partial") continue;
    if (c[f.severity] !== undefined) c[f.severity]++;
  }
  return c;
}
const scoreOf = (r) => (r.type === "security-audit" ? r.securityScore ?? r.overall : r.overall);
const toRow = (r) => ({
  file: r.file,
  type: r.type === "security-audit" ? "security" : "audit",
  date: r.date,
  mode: r.mode,
  overall: typeof scoreOf(r) === "number" ? scoreOf(r) : null,
  verdict: r.verdict ?? "",
  scores: Object.fromEntries((r.categories ?? []).map((c) => [c.id, typeof c.score === "number" ? c.score : null])),
  keyFindings: Object.fromEntries((r.categories ?? []).map((c) => [c.id, c.keyFinding ?? ""])),
  counts: counts(r),
});
const rows = base.map(toRow);
const secRows = audits.length ? secAudits.map(toRow) : [];
const fixRows = fixes.map((r) => ({ file: r.file, date: r.date, overall: r.overall ?? null }));
const latest = rows[rows.length - 1];
const prev = rows.length > 1 ? rows[rows.length - 2] : null;
const appName = base[base.length - 1].stack?.name ?? path.basename(appRoot);

// ---------- badge ----------
const statusOf = (s) => (s == null ? "na" : s >= 8 ? "good" : s >= 5 ? "warning" : "critical");
const BADGE_COLORS = { good: "#0ca30c", warning: "#c98500", critical: "#d03b3b", na: "#6b6a65" };
const w = (t) => Math.round(t.length * 6.6 + 12);
function writeBadge(name, label, row) {
const message = row.overall == null ? "n/a" : `${row.overall.toFixed(1)}/10`;
const lw = w(label), mw = w(message);
const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + mw}" height="20" role="img" aria-label="${label}: ${message}">
<title>${label}: ${message}${row.verdict ? ` (${row.verdict})` : ""}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${lw + mw}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${BADGE_COLORS[statusOf(row.overall)]}"/><rect width="${lw + mw}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${label}</text><text x="${lw + mw / 2}" y="14">${message}</text></g></svg>
`;
fs.writeFileSync(path.join(dir, `${name}.svg`), badgeSvg);
fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({
  schemaVersion: 1, label, message, color: { good: "brightgreen", warning: "yellow", critical: "red", na: "lightgrey" }[statusOf(row.overall)],
}, null, 2) + "\n");
return message;
}
const message = writeBadge("badge", audits.length ? "expo audit" : "security", latest);
const latestSec = secAudits.length ? toRow(secAudits[secAudits.length - 1]) : null;
if (latestSec) writeBadge("badge-security", "security", latestSec);

// ---------- page ----------
const data = { appName, generatedAt: new Date().toISOString(), categories: CATEGORIES, rows, secRows, fixRows };
const tableRows = [...rows, ...secRows].sort((a, b) => `${a.date}|${a.file}`.localeCompare(`${b.date}|${b.file}`));
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const delta = prev && latest.overall != null && prev.overall != null ? latest.overall - prev.overall : null;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit History · ${esc(appName)}</title>
<style>
:root {
  color-scheme: light;
  --surface-0: #f5f4f1; --surface-1: #fcfcfb; --border: #e3e2dd; --grid: #ecebe7;
  --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #77766f;
  --series-1: #2a78d6; --series-1-soft: #2a78d61f;
  --good: #0ca30c; --warning: #fab219; --serious: #ec835a; --critical: #d03b3b; --na: #b4b3ad;
  --good-text: #006300; --warning-text: #8a5a00; --critical-text: #b42525;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --surface-0: #121211; --surface-1: #1a1a19; --border: #2e2e2b; --grid: #262624;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #9a998f;
    --series-1: #3987e5; --series-1-soft: #3987e526; --na: #55544f;
    --good-text: #4fd14f; --warning-text: #fab219; --critical-text: #f07a7a;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface-0: #121211; --surface-1: #1a1a19; --border: #2e2e2b; --grid: #262624;
  --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #9a998f;
  --series-1: #3987e5; --series-1-soft: #3987e526; --na: #55544f;
  --good-text: #4fd14f; --warning-text: #fab219; --critical-text: #f07a7a;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface-0); color: var(--text-primary); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 24px 16px 48px; }
header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 16px; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 0 0 12px; }
.muted { color: var(--text-muted); }
.secondary { color: var(--text-secondary); }
.card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.hero { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; }
.tile .label { color: var(--text-secondary); font-size: 12px; }
.tile .value { font-size: 32px; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.tile .sub { font-size: 12px; color: var(--text-muted); }
.status { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
.s-good { color: var(--good-text); } .s-good .dot { background: var(--good); }
.s-warning { color: var(--warning-text); } .s-warning .dot { background: var(--warning); }
.s-critical { color: var(--critical-text); } .s-critical .dot { background: var(--critical); }
.s-na { color: var(--text-muted); } .s-na .dot { background: var(--na); }
.chart-wrap { position: relative; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
.axis text { fill: var(--text-muted); font-size: 11px; }
.gridline { stroke: var(--grid); stroke-width: 1; }
.multiples { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.mini { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; position: relative; }
.mini .top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.mini .name { font-size: 12px; color: var(--text-secondary); }
.mini .score { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
.mini .kf { font-size: 11px; color: var(--text-muted); margin-top: 4px; min-height: 2.6em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.tip { position: absolute; pointer-events: none; background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 4px 16px #0000001f; white-space: nowrap; display: none; z-index: 2; }
.tip b { font-variant-numeric: tabular-nums; }
.table-scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { color: var(--text-secondary); font-weight: 600; font-size: 12px; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.note { font-size: 12px; color: var(--text-muted); }
a { color: var(--series-1); }
button.theme { background: none; border: 1px solid var(--border); color: var(--text-secondary); border-radius: 8px; padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12px; }
</style>
</head>
<body>
<main>
<header>
  <div><h1>Audit history · ${esc(appName)}</h1><div class="muted">${rows.length} ${audits.length ? "audit" : "security audit"}${rows.length === 1 ? "" : "s"}${secRows.length ? ` · ${secRows.length} security audit${secRows.length === 1 ? "" : "s"}` : ""}${fixRows.length ? ` · ${fixRows.length} fix run${fixRows.length === 1 ? "" : "s"}` : ""} · generated by expo-es-kit</div></div>
  <button class="theme" id="theme" type="button">Toggle theme</button>
</header>

<section class="card hero" aria-label="Latest audit">
  <div class="tile"><div class="label">Overall score</div><div class="value">${latest.overall == null ? "—" : latest.overall.toFixed(1)}<span class="muted" style="font-size:16px"> / 10</span></div>
    <div class="sub">${delta == null ? "first audit" : `${delta >= 0 ? "▲ +" : "▼ "}${delta.toFixed(1)} vs ${esc(prev.date)}`}</div></div>
  <div class="tile"><div class="label">Verdict</div><div class="value" style="font-size:20px;margin-top:8px"><span class="status ${latest.verdict === "GO" ? "s-good" : latest.verdict === "NO-GO" ? "s-critical" : "s-warning"}"><span class="dot"></span>${esc(latest.verdict || "—")}</span></div><div class="sub">${esc(latest.date)} · ${esc(latest.mode ?? "")}</div></div>
  <div class="tile"><div class="label">Open findings</div><div class="value">${latest.counts.P0 + latest.counts.P1 + latest.counts.P2}</div><div class="sub">P0 ${latest.counts.P0} · P1 ${latest.counts.P1} · P2 ${latest.counts.P2}</div></div>
  <div class="tile"><div class="label">Badge</div><div style="margin-top:10px"><img src="badge.svg" alt="expo audit ${esc(message)}"></div><div class="sub">docs/audits/badge.svg</div></div>
</section>

<section class="card">
  <h2>Overall score over time</h2>
  <div class="chart-wrap" id="overall"></div>
  ${rows.length < 2 ? '<p class="note">Run another audit to see the trend.</p>' : ""}
</section>
${secRows.length ? `
<section class="card">
  <h2>Security score over time</h2>
  <p class="note" style="margin-top:-6px">From <code>/expo-es-kit:security</code> reports. Latest: ${latestSec.overall == null ? "—" : latestSec.overall.toFixed(1)} / 10 · ${esc(latestSec.verdict)} · <img src="badge-security.svg" alt="security ${latestSec.overall == null ? "n/a" : latestSec.overall.toFixed(1)}" style="vertical-align:middle"></p>
  <div class="chart-wrap" id="security"></div>
</section>` : ""}

<section class="card">
  <h2>Categories</h2>
  <p class="note" style="margin-top:-6px">Same 0–10 scale in every panel. Hover a panel for values.</p>
  <div class="multiples" id="multiples"></div>
</section>

<section class="card">
  <h2>Open findings per audit</h2>
  <div class="legend"><span><i class="swatch" style="background:var(--critical)"></i>P0 blocking</span><span><i class="swatch" style="background:var(--serious)"></i>P1 significant</span><span><i class="swatch" style="background:var(--warning)"></i>P2 hygiene</span></div>
  <div class="chart-wrap" id="findings"></div>
</section>

<section class="card">
  <h2>All audits</h2>
  <div class="table-scroll"><table>
    <thead><tr><th>Date</th><th>Type</th><th>Mode</th><th class="num">Overall</th><th>Verdict</th><th class="num">P0</th><th class="num">P1</th><th class="num">P2</th><th>Report</th></tr></thead>
    <tbody>${tableRows.slice().reverse().map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.type)}</td><td>${esc(r.mode)}</td><td class="num">${r.overall == null ? "—" : r.overall.toFixed(1)}</td><td>${esc(r.verdict)}</td><td class="num">${r.counts.P0}</td><td class="num">${r.counts.P1}</td><td class="num">${r.counts.P2}</td><td><a href="${esc(r.file.replace(/\.json$/, ".md"))}">${esc(r.file.replace(/\.json$/, ".md"))}</a></td></tr>`).join("")}</tbody>
  </table></div>
</section>
</main>

<script id="data" type="application/json">${json}</script>
<script>
(() => {
  const D = JSON.parse(document.getElementById("data").textContent);
  const rows = D.rows;
  const NS = "http://www.w3.org/2000/svg";
  const el = (n, a = {}, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  const statusOf = (s) => s == null ? "na" : s >= 8 ? "good" : s >= 5 ? "warning" : "critical";
  const STATUS_LABEL = { good: "Good", warning: "Needs work", critical: "Critical", na: "n/a" };
  const fmt = (v) => v == null ? "—" : v.toFixed(1);

  document.getElementById("theme").addEventListener("click", () => {
    const r = document.documentElement;
    const dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    r.dataset.theme = dark ? "light" : "dark";
  });

  function tooltip(wrap) {
    const t = document.createElement("div"); t.className = "tip"; wrap.appendChild(t);
    return {
      show(html, x, y) { t.innerHTML = html; t.style.display = "block"; const w = t.offsetWidth; const max = wrap.clientWidth - w - 4; t.style.left = Math.max(4, Math.min(x + 12, max)) + "px"; t.style.top = Math.max(0, y - 10) + "px"; },
      hide() { t.style.display = "none"; },
    };
  }

  // Line chart: one series, y fixed 0..10, crosshair + tooltip.
  function lineChart(wrap, points, opts) {
    const W = opts.width, H = opts.height, m = opts.margin;
    const svg = el("svg", { viewBox: \`0 0 \${W} \${H}\`, role: "img", "aria-label": opts.label });
    wrap.appendChild(svg);
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = points.length;
    const x = (i) => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v) => m.t + ih - (v / 10) * ih;
    const g = el("g", { class: "axis" }, svg);
    for (const v of opts.ticks) {
      el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "gridline" }, g);
      if (opts.showAxis) { const t = el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, g); t.textContent = v; }
    }
    if (opts.showAxis) points.forEach((p, i) => {
      const maxLabels = Math.max(2, Math.floor(W / 110));
      if (n > maxLabels && i % Math.ceil(n / maxLabels) !== 0 && i !== n - 1) return;
      const t = el("text", { x: x(i), y: H - 6, "text-anchor": n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle" }, g); t.textContent = p.date;
    });
    const valid = points.map((p, i) => [i, p.v]).filter(([, v]) => v != null);
    if (valid.length > 1) {
      const d = valid.map(([i, v], k) => \`\${k ? "L" : "M"}\${x(i)},\${y(v)}\`).join("");
      if (opts.area) el("path", { d: d + \`L\${x(valid[valid.length - 1][0])},\${y(0)}L\${x(valid[0][0])},\${y(0)}Z\`, fill: "var(--series-1-soft)" }, svg);
      el("path", { d, fill: "none", stroke: "var(--series-1)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    }
    const last = valid[valid.length - 1];
    if (last) el("circle", { cx: x(last[0]), cy: y(last[1]), r: opts.dot, fill: "var(--series-1)", stroke: "var(--surface-1)", "stroke-width": 2 }, svg);
    const cross = el("line", { y1: m.t, y2: m.t + ih, stroke: "var(--text-muted)", "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" }, svg);
    const hover = el("circle", { r: opts.dot, fill: "var(--series-1)", stroke: "var(--surface-1)", "stroke-width": 2, visibility: "hidden" }, svg);
    const tip = tooltip(wrap);
    const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }, svg);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      const p = points[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      if (p.v != null) { hover.setAttribute("cx", x(i)); hover.setAttribute("cy", y(p.v)); hover.setAttribute("visibility", "visible"); } else hover.setAttribute("visibility", "hidden");
      tip.show(opts.tip(p, i), (x(i) / W) * r.width, (p.v != null ? y(p.v) : m.t) / H * r.height);
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hover.setAttribute("visibility", "hidden"); tip.hide(); });
    return svg;
  }

  function renderAll() {
  for (const id of ["overall", "security", "multiples", "findings"]) { const n = document.getElementById(id); if (n) n.innerHTML = ""; }
  const ow = Math.max(300, document.getElementById("overall").clientWidth);
  // Overall
  lineChart(document.getElementById("overall"), rows.map((r) => ({ date: r.date, v: r.overall, r })), {
    width: ow, height: ow < 600 ? 200 : 260, margin: { t: 12, r: 16, b: 26, l: 32 }, ticks: [0, 2, 4, 6, 8, 10], showAxis: true, area: true, dot: 4,
    label: "Overall audit score over time, 0 to 10",
    tip: (p) => \`<div class="muted">\${p.date} · \${p.r.mode || ""}</div><div>Overall <b>\${fmt(p.v)}</b> / 10</div><div>\${p.r.verdict || ""}</div><div class="muted">P0 \${p.r.counts.P0} · P1 \${p.r.counts.P1} · P2 \${p.r.counts.P2}</div>\`,
  });

  const secWrap = document.getElementById("security");
  if (secWrap) lineChart(secWrap, D.secRows.map((r) => ({ date: r.date, v: r.overall, r })), {
    width: ow, height: ow < 600 ? 160 : 200, margin: { t: 12, r: 16, b: 26, l: 32 }, ticks: [0, 2, 4, 6, 8, 10], showAxis: true, area: true, dot: 4,
    label: "Security score over time, 0 to 10",
    tip: (p) => \`<div class="muted">\${p.date} · \${p.r.mode || ""}</div><div>Security <b>\${fmt(p.v)}</b> / 10</div><div>\${p.r.verdict || ""}</div><div class="muted">P0 \${p.r.counts.P0} · P1 \${p.r.counts.P1} · P2 \${p.r.counts.P2}</div>\`,
  });

  // Small multiples per category
  const mult = document.getElementById("multiples");
  for (const [id, name] of D.categories) {
    const series = rows.map((r) => ({ date: r.date, v: r.scores[id] ?? null }));
    if (series.every((p) => p.v == null)) continue;
    const lastScore = series[series.length - 1].v;
    const prevScore = series.length > 1 ? series[series.length - 2].v : null;
    const st = statusOf(lastScore);
    const card = document.createElement("div"); card.className = "mini";
    const d = lastScore != null && prevScore != null ? lastScore - prevScore : null;
    card.innerHTML = \`<div class="top"><span class="name">\${name}</span><span class="score">\${fmt(lastScore)}</span></div>
      <div class="top" style="font-size:11px"><span class="status s-\${st}"><span class="dot"></span>\${STATUS_LABEL[st]}</span><span class="muted">\${d == null ? "" : (d >= 0 ? "▲ +" : "▼ ") + d.toFixed(1)}</span></div>\`;
    const w = document.createElement("div"); w.className = "chart-wrap"; card.appendChild(w);
    mult.appendChild(card);
    lineChart(w, series, { width: Math.max(160, w.clientWidth), height: 64, margin: { t: 6, r: 6, b: 6, l: 6 }, ticks: [0, 5, 10], showAxis: false, area: false, dot: 3,
      label: name + " score over time", tip: (p) => \`<div class="muted">\${p.date}</div><div>\${name} <b>\${fmt(p.v)}</b></div>\` });
    const kf = document.createElement("div"); kf.className = "kf"; kf.textContent = rows[rows.length - 1].keyFindings[id] || ""; card.appendChild(kf);
  }

  // Stacked bars: open findings per audit
  (function bars() {
    const wrap = document.getElementById("findings");
    const W = Math.max(300, wrap.clientWidth), H = 220, m = { t: 10, r: 16, b: 26, l: 32 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(1, ...rows.map((r) => r.counts.P0 + r.counts.P1 + r.counts.P2));
    const nice = Math.ceil(max / 5) * 5 || 5;
    const y = (v) => m.t + ih - (v / nice) * ih;
    const svg = el("svg", { viewBox: \`0 0 \${W} \${H}\`, role: "img", "aria-label": "Open findings per audit by severity" }); wrap.appendChild(svg);
    const g = el("g", { class: "axis" }, svg);
    for (let v = 0; v <= nice; v += nice / 5) { el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "gridline" }, g); const t = el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, g); t.textContent = v; }
    const slot = iw / rows.length, bw = Math.min(36, slot * 0.6);
    const tip = tooltip(wrap);
    rows.forEach((r, i) => {
      const cx = m.l + slot * i + slot / 2;
      let base = 0;
      const segs = [["P2", "var(--warning)"], ["P1", "var(--serious)"], ["P0", "var(--critical)"]];
      const topSeg = [...segs].reverse().find(([k]) => r.counts[k] > 0)?.[0];
      for (const [k, color] of segs) {
        const v = r.counts[k]; if (!v) continue;
        const y0 = y(base), y1 = y(base + v);
        const h = Math.max(0, y0 - y1 - (base > 0 ? 2 : 0));
        if (k === topSeg) {
          const rr = Math.min(4, h / 2, bw / 2);
          el("path", { d: \`M\${cx - bw / 2},\${y1 + h}V\${y1 + rr}Q\${cx - bw / 2},\${y1} \${cx - bw / 2 + rr},\${y1}H\${cx + bw / 2 - rr}Q\${cx + bw / 2},\${y1} \${cx + bw / 2},\${y1 + rr}V\${y1 + h}Z\`, fill: color }, svg);
        } else el("rect", { x: cx - bw / 2, y: y1, width: bw, height: h, fill: color }, svg);
        base += v;
      }
      const maxLabels = Math.max(2, Math.floor(W / 90));
      if (rows.length <= maxLabels || i % Math.ceil(rows.length / maxLabels) === 0 || i === rows.length - 1) { const t = el("text", { x: cx, y: H - 6, "text-anchor": "middle" }, g); t.textContent = r.date; }
      const hit = el("rect", { x: cx - slot / 2, y: m.t, width: slot, height: ih, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (ev) => { const b = svg.getBoundingClientRect(); tip.show(\`<div class="muted">\${r.date}</div><div>P0 <b>\${r.counts.P0}</b> · P1 <b>\${r.counts.P1}</b> · P2 <b>\${r.counts.P2}</b></div>\`, ev.clientX - b.left, ev.clientY - b.top); });
      hit.addEventListener("pointerleave", () => tip.hide());
    });
  })();
  }
  renderAll();
  let lastW = innerWidth, t;
  addEventListener("resize", () => { if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(t); t = setTimeout(renderAll, 120); });
})();
</script>
</body>
</html>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(JSON.stringify({
  ok: true, html: path.relative(appRoot, out), badgeSvg: path.relative(appRoot, path.join(dir, "badge.svg")),
  badgeJson: path.relative(appRoot, path.join(dir, "badge.json")), audits: rows.length, securityAudits: secAudits.length, fixes: fixRows.length,
  securityBadge: latestSec ? path.relative(appRoot, path.join(dir, "badge-security.svg")) : null,
  latest: { date: latest.date, overall: latest.overall, verdict: latest.verdict },
}, null, 2));
