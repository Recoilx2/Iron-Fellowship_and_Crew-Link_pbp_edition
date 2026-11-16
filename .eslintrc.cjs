module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh", "react"],
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    "react/react-in-jsx-scope": 0,
    // Firebase was removed (spec #11): no Firebase import may return.
    // Supabase is an implementation detail of the data layer. Stores, pages,
    // components and other app code must use app-owned types
    // (see src/api-calls/helpers.type.ts) — the data layer converts at its
    // edge.
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["firebase", "firebase/*"],
            message:
              "Firebase was removed. Use the Supabase-backed data layer (src/api-calls) instead.",
          },
          {
            group: ["@supabase/*"],
            message:
              "Supabase imports are only allowed in the data layer (src/api-calls) and src/config/supabase.config.ts. Use app-owned types instead.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // A bare console.error/warn logs whole error objects (a PostgrestError's
      // `details` can hold post text). Use logError/logWarning from
      // functions/errorReference, which log a safe summary (ticket #176).
      files: ["src/**/*.{ts,tsx}"],
      excludedFiles: [
        "src/functions/errorReference.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
      ],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "CallExpression[callee.object.name='console'][callee.property.name=/^(error|warn)$/]",
            message:
              "Use logError/logWarning from functions/errorReference instead of a bare console.error/console.warn.",
          },
          {
            // The computed form too: console["error"](...) gets past a
            // property-name match alone.
            selector:
              "CallExpression[callee.object.name='console'][callee.computed=true][callee.property.value=/^(error|warn)$/]",
            message:
              "Use logError/logWarning from functions/errorReference instead of a bare console.error/console.warn.",
          },
          {
            selector:
              "MemberExpression[object.name='console'][property.name=/^(error|warn)$/]:not(CallExpression > MemberExpression.callee)",
            message:
              "Do not pass console.error/console.warn as a callback; use logError/logWarning from functions/errorReference.",
          },
          {
            // The computed form of the same, e.g. .catch(console["error"]).
            selector:
              "MemberExpression[object.name='console'][computed=true][property.value=/^(error|warn)$/]:not(CallExpression > MemberExpression.callee)",
            message:
              "Do not pass console.error/console.warn as a callback; use logError/logWarning from functions/errorReference.",
          },
        ],
      },
    },
    {
      // The data layer may use Supabase, but Firebase stays banned
      // everywhere (spec #11 removed it completely). The browser tests
      // (spec #9, ticket #107) sign people in through the Auth Admin API
      // like the data-layer test harness does, so they need Supabase too.
      files: [
        "src/api-calls/**/*",
        "src/config/supabase.config.ts",
        "e2e/**/*",
        "playwright.config.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["firebase", "firebase/*"],
                message:
                  "Firebase was removed. Use the Supabase-backed data layer (src/api-calls) instead.",
              },
            ],
          },
        ],
      },
    },
  ],
  settings: {
    react: {
      version: "detect",
    },
  },
};
