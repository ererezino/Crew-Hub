import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "scripts/**"]),

  // i18n: error on hardcoded literal strings in user-facing UI files
  {
    files: [
      "app/(shell)/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
    ],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/*.stories.{ts,tsx}",
      "**/*.fixture.{ts,tsx}",
    ],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["error", {
        // NOTE: Do NOT add `words.exclude` here — it replaces the plugin's
        // built-in defaults (which already skip punctuation, single chars,
        // whitespace-only strings, etc.) and would cause hundreds of false positives.
        "jsx-components": {
          exclude: [
            "Trans",
            // <code> elements display technical identifiers (e.g. DB column names).
            // These are not translatable user-facing text.
            "code",
          ],
        },
      }],
    },
  },
]);
