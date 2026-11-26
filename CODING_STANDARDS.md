# Coding standards

Read by the reviewer (`code-review`'s Standards section). Owned by this project.

Each rule is one line, names the incident that caused it, and becomes an
automated check wherever it can. Anything a linter already enforces doesn't
belong here.

<!-- - <rule> (incident: <ticket or PR>, <date>) -->

Seeded at setup (2026-11-25) from the rules this project's tools already
enforce, so a reviewer knows the intent behind a lint error. The tools stay
the proof: `npm run lint` and `npx tsc --noEmit` in the verify command.

- No Firebase import anywhere; it was removed (incident: spec #11; ESLint `no-restricted-imports`).
- `@supabase/*` is imported only in the data layer (`src/api-calls`), `src/config/supabase.config.ts` and the browser tests; other app code uses app-owned types from `src/api-calls/helpers.type.ts` (incident: spec #11; ESLint `no-restricted-imports`).
- No bare `console.*` call or callback in `src/`; log through `logError`/`logWarning` from `functions/errorReference`, which log a safe summary (incident: ticket #176, PR #186 review; ESLint `no-restricted-syntax`).
- No bare `console.*` in `supabase/functions/`; log through `logServerError` from `gm-assistant/log`, which mints a reference and sanitizes (incident: ticket #183; ESLint `no-restricted-syntax`).
- TypeScript strict mode, no type errors, zero lint warnings and no unused disable directives (incident: project baseline; `tsconfig.json` `strict`, lint `--max-warnings 0 --report-unused-disable-directives`).
