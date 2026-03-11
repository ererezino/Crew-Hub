#!/usr/bin/env node

/**
 * ICU MessageFormat syntax validator for i18n message files.
 *
 * Checks that every leaf value in en.json and fr.json uses valid ICU
 * syntax (balanced braces, no stray openers/closers). Also verifies
 * that EN and FR use the same set of ICU argument names for each key.
 *
 * Usage:
 *   node scripts/check-i18n-icu.cjs
 */

const path = require("path");
const fs = require("fs");

const MESSAGES_DIR = path.resolve(__dirname, "..", "messages");

/* ---- helpers ---- */

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Walk the message object and collect { key, value } pairs for all
 * leaf strings.
 */
function getLeafEntries(obj, prefix = "") {
  const entries = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      entries.push(...getLeafEntries(val, fullKey));
    } else if (typeof val === "string") {
      entries.push({ key: fullKey, value: val });
    }
  }
  return entries;
}

/**
 * Check that braces are balanced in an ICU message string.
 * Returns an error message or null.
 *
 * Note: We intentionally do NOT treat single apostrophes as ICU escape
 * characters. The strict ICU spec uses ' to escape braces, but next-intl
 * handles apostrophes transparently (e.g. "You're", "l'équipe").
 * We only care about { } balance.
 */
function checkBraces(value) {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth < 0) {
      return `Unexpected closing brace at position ${i}`;
    }
  }
  if (depth !== 0) {
    return `${depth} unclosed brace(s)`;
  }
  return null;
}

/**
 * Extract ICU argument names from a message string.
 * E.g. "Hello {name}, you have {count} items" → ["name", "count"]
 */
function extractArgNames(value) {
  const names = new Set();
  // Simple regex: top-level {argName} or {argName, type} or {argName, type, ...}
  const re = /\{(\w+)(?:,[^}]*)?\}/g;
  let match;
  while ((match = re.exec(value)) !== null) {
    names.add(match[1]);
  }
  return names;
}

/* ---- main ---- */

const errors = [];
const warnings = [];

const localeFiles = ["en.json", "fr.json"];
const allEntries = {};

for (const file of localeFiles) {
  const filePath = path.join(MESSAGES_DIR, file);
  const data = loadJson(filePath);
  const entries = getLeafEntries(data);
  allEntries[file] = new Map(entries.map((e) => [e.key, e.value]));

  // Check brace balance
  for (const { key, value } of entries) {
    const braceError = checkBraces(value);
    if (braceError) {
      errors.push(`[${file}] ${key}: ${braceError}`);
    }
  }
}

// Cross-locale ICU argument check
const enEntries = allEntries["en.json"];
const frEntries = allEntries["fr.json"];

for (const [key, enValue] of enEntries) {
  const frValue = frEntries.get(key);
  if (!frValue) continue; // parity script catches missing keys

  const enArgs = extractArgNames(enValue);
  const frArgs = extractArgNames(frValue);

  // Check for args in EN but missing in FR
  for (const arg of enArgs) {
    if (!frArgs.has(arg)) {
      warnings.push(
        `${key}: argument {${arg}} present in en.json but missing in fr.json`
      );
    }
  }

  // Check for args in FR but missing in EN
  for (const arg of frArgs) {
    if (!enArgs.has(arg)) {
      warnings.push(
        `${key}: argument {${arg}} present in fr.json but missing in en.json`
      );
    }
  }
}

/* ---- output ---- */

console.log(`\n🔤 ICU Syntax Check`);
console.log(`   Checked ${enEntries.size} EN keys + ${frEntries.size} FR keys`);

if (warnings.length > 0) {
  console.log(`\n⚠️  ${warnings.length} argument mismatch warning(s):`);
  warnings.forEach((w) => console.log(`   - ${w}`));
}

if (errors.length > 0) {
  console.log(`\n❌ ${errors.length} syntax error(s):`);
  errors.forEach((e) => console.log(`   - ${e}`));
  console.log(`\n❌ FAIL — ICU syntax errors found.\n`);
  process.exit(1);
} else {
  console.log(`\n✅ PASS — all ICU syntax is valid.`);
  if (warnings.length > 0) {
    console.log(`   (${warnings.length} warning(s) — review argument mismatches above)\n`);
  } else {
    console.log("");
  }
  process.exit(0);
}
