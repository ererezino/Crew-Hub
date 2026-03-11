#!/usr/bin/env node

/**
 * CI-ready i18n parity check.
 *
 * Validates that en.json and fr.json have identical key structures.
 * Exits with code 1 on mismatch so CI fails early.
 *
 * Usage:
 *   node scripts/check-i18n-parity.cjs
 */

const path = require("path");
const fs = require("fs");

const MESSAGES_DIR = path.resolve(__dirname, "..", "messages");
const EN_PATH = path.join(MESSAGES_DIR, "en.json");
const FR_PATH = path.join(MESSAGES_DIR, "fr.json");

/* ---- helpers ---- */

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function getLeafKeys(obj, prefix = "") {
  const keys = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (
      typeof obj[key] === "object" &&
      obj[key] !== null &&
      !Array.isArray(obj[key])
    ) {
      keys.push(...getLeafKeys(obj[key], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function countNamespaces(obj) {
  return Object.keys(obj).length;
}

/* ---- main ---- */

const en = loadJson(EN_PATH);
const fr = loadJson(FR_PATH);

const enKeys = new Set(getLeafKeys(en));
const frKeys = new Set(getLeafKeys(fr));

const missingInFr = [...enKeys].filter((k) => !frKeys.has(k));
const missingInEn = [...frKeys].filter((k) => !enKeys.has(k));

const enNamespaces = countNamespaces(en);
const frNamespaces = countNamespaces(fr);

console.log(`\n🌐 i18n Parity Check`);
console.log(`   EN: ${enKeys.size} keys across ${enNamespaces} namespaces`);
console.log(`   FR: ${frKeys.size} keys across ${frNamespaces} namespaces`);

if (missingInFr.length > 0) {
  console.log(`\n❌ ${missingInFr.length} keys in en.json but MISSING in fr.json:`);
  missingInFr.forEach((k) => console.log(`   - ${k}`));
}

if (missingInEn.length > 0) {
  console.log(`\n❌ ${missingInEn.length} keys in fr.json but MISSING in en.json:`);
  missingInEn.forEach((k) => console.log(`   - ${k}`));
}

if (missingInFr.length === 0 && missingInEn.length === 0) {
  console.log(`\n✅ PASS — en.json and fr.json have identical key structures.\n`);
  process.exit(0);
} else {
  const total = missingInFr.length + missingInEn.length;
  console.log(`\n❌ FAIL — ${total} key mismatch(es) found.\n`);
  process.exit(1);
}
