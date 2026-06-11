#!/usr/bin/env node
/**
 * Generates lib/i18n/route-namespaces.generated.json — the map of which
 * translation namespaces each (shell) area's client tree consumes.
 *
 * Why: the root NextIntlClientProvider used to ship the FULL locale bundle
 * (~290KB en / ~320KB fr) in the RSC payload of every page load. Per-area
 * layouts now provide only the namespaces that area actually uses. This
 * script derives those sets by walking each area's import graph, so the map
 * can never silently drift from the code — tests/i18n-route-namespaces.test.ts
 * fails if the committed map differs from a fresh generation.
 *
 * Bias: over-inclusion. Namespaces are collected from EVERY traversed file
 * (server components resolve translations server-side, so including their
 * namespaces costs a few bytes but can never break). Under-inclusion would
 * degrade to the getMessageFallback key-path text, never a crash — but we
 * still try hard not to miss anything.
 *
 * Run: node scripts/generate-route-namespaces.cjs [--check]
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SHELL_DIR = path.join(ROOT, "app", "(shell)");
const OUT_FILE = path.join(ROOT, "lib", "i18n", "route-namespaces.generated.json");

const SOURCE_EXTS = [".tsx", ".ts"];
/* Namespaces every area gets regardless of detection — tiny, used by shared
 * chrome that can mount anywhere (toasts, dialogs, theme/locale switches). */
const ALWAYS_INCLUDED = ["common", "nav", "locale", "theme", "errorBoundary"];

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...listFiles(full));
    } else if (SOURCE_EXTS.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function resolveImport(fromFile, spec) {
  /* Only follow project-internal imports. */
  let base;
  if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else if (spec.startsWith("@/")) {
    base = path.join(ROOT, spec.slice(2));
  } else {
    return null; // package import
  }
  const candidates = [
    base,
    ...SOURCE_EXTS.map((ext) => base + ext),
    ...SOURCE_EXTS.map((ext) => path.join(base, "index" + ext))
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^"'\n]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
const NAMESPACE_RE = /(?:useTranslations|getTranslations)\(\s*["']([^"'.]+)(?:\.[^"']*)?["']/g;
/* getTranslations({locale, namespace: "x"}) object form */
const NAMESPACE_OBJ_RE = /getTranslations\(\s*\{[^}]*namespace:\s*["']([^"'.]+)(?:\.[^"']*)?["']/g;

function collect(entryFiles) {
  const seen = new Set();
  const namespaces = new Set();
  const dynamicUses = [];
  const queue = [...entryFiles];

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const match of src.matchAll(NAMESPACE_RE)) {
      namespaces.add(match[1]);
    }
    for (const match of src.matchAll(NAMESPACE_OBJ_RE)) {
      namespaces.add(match[1]);
    }
    /* Flag non-literal namespace args so a human looks at them. */
    for (const match of src.matchAll(/useTranslations\(\s*([^"')][^)]*)\)/g)) {
      dynamicUses.push(`${path.relative(ROOT, file)}: useTranslations(${match[1].trim()})`);
    }

    for (const match of src.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? match[3];
      if (!spec) continue;
      const resolved = resolveImport(file, spec);
      if (resolved && !seen.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return { namespaces, dynamicUses };
}

function sortedUnion(...sets) {
  const out = new Set();
  for (const s of sets) for (const v of s) out.add(v);
  return [...out].sort();
}

/* ── Areas: every top-level segment under app/(shell)/ ── */
const areaDirs = fs
  .readdirSync(SHELL_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/* ── Shell set: root layout + (shell) layout + everything OUTSIDE (shell)
 *    (login, mfa-setup, auth, privacy, terms, error pages) ── */
const shellEntries = [];
for (const entry of fs.readdirSync(path.join(ROOT, "app"), { withFileTypes: true })) {
  const full = path.join(ROOT, "app", entry.name);
  if (entry.name === "(shell)" || entry.name === "api") continue;
  if (entry.isDirectory()) shellEntries.push(...listFiles(full));
  else if (SOURCE_EXTS.includes(path.extname(entry.name))) shellEntries.push(full);
}
/* (shell)/layout.tsx and any loose files directly in (shell)/ */
for (const entry of fs.readdirSync(SHELL_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() && SOURCE_EXTS.includes(path.extname(entry.name))) {
    shellEntries.push(path.join(SHELL_DIR, entry.name));
  }
}

const allDynamic = [];
const shellResult = collect(shellEntries);
allDynamic.push(...shellResult.dynamicUses);
const shell = sortedUnion(shellResult.namespaces, ALWAYS_INCLUDED);

const areas = {};
for (const area of areaDirs.sort()) {
  const result = collect(listFiles(path.join(SHELL_DIR, area)));
  allDynamic.push(...result.dynamicUses);
  areas[area] = sortedUnion(result.namespaces, ALWAYS_INCLUDED);
}

if (allDynamic.length > 0) {
  console.error("Non-literal useTranslations() arguments found — the walker cannot");
  console.error("resolve these; add the namespace to ALWAYS_INCLUDED or refactor:");
  for (const use of allDynamic) console.error("  - " + use);
  process.exit(1);
}

const output = { shell, areas };
const serialized = JSON.stringify(output, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const existing = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, "utf8") : "";
  if (existing !== serialized) {
    console.error("❌ lib/i18n/route-namespaces.generated.json is stale.");
    console.error("   Run: node scripts/generate-route-namespaces.cjs");
    process.exit(1);
  }
  console.log("✅ route-namespaces map is current.");
} else {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, serialized);
  const sizes = Object.entries(areas)
    .map(([k, v]) => `${k}: ${v.length}`)
    .join(", ");
  console.log(`shell: ${shell.length} namespaces | ${sizes}`);
}
