import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // TOOLING-01: keep the canonical root `eslint .` deterministic over the real
  // repository. `.claude/` (agent worktrees) and `artifacts/` are generated /
  // untracked scratch dirs — linting them produced ~58 spurious errors unrelated
  // to source. They are ignored here, NOT any source-controlled application code.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
    ".claude/**",
    "artifacts/**",
    "coverage/**"
  ]),

  // Allow underscore-prefixed variables to signal intentionally unused bindings
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },

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
