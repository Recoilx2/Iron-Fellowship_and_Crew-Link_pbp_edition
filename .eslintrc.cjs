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
    // Supabase is an implementation detail of the data layer. Stores, pages,
    // components and other app code must use app-owned types (see
    // src/api-calls/helpers.type.ts) — the data layer converts at its edge.
    "no-restricted-imports": [
      "error",
      {
        patterns: [
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
      files: ["src/api-calls/**/*", "src/config/supabase.config.ts"],
      rules: { "no-restricted-imports": "off" },
    },
  ],
  settings: {
    react: {
      version: "detect",
    },
  },
};
