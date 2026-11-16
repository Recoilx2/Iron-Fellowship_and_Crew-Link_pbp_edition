/**
 * Deployment config and prompt text for the GM assistant function
 * (spec #10). Split out of `handler.ts` (ticket #151): everything here is
 * about what the operator configured and what the model is told, not about
 * requests or routing.
 */

/** Deployment config, built from the environment by the runtime wiring. */
export interface GmAssistantEnv {
  /** Base URL of the OpenAI-compatible endpoint; blank means not set up. */
  endpoint: string;
  /** Server-side API key; never returned, logged or forwarded to browsers. */
  apiKey: string;
  /** Raw comma-separated allow-list; blank means every upstream model. */
  allowedModels: string;
  /** Raw default context size; blank or invalid means 8192. */
  contextTokens: string;
  /** HS256 secret the stack signs access tokens with. */
  jwtSecret: string;
  /** PostgREST base URL (inside the stack network, e.g. http://api-gw:8000). */
  supabaseUrl: string;
  /** Anon key, sent as the PostgREST `apikey` header beside the caller JWT. */
  anonKey: string;
  /** The site's own origin; the only origin CORS ever echoes. */
  siteUrl: string;
  /** Game system of this copy (`ironsworn` or `starforged`). */
  gameSystem: string;
}

/**
 * Every outgoing call — PostgREST reads with the caller's JWT and the
 * upstream model calls with the server-side key. Tests inject a fake; the
 * runtime passes `fetch`.
 */
export type UpstreamFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const DEFAULT_CONTEXT_TOKENS = 8192;

export function parseAllowedModels(raw: string): string[] | null {
  const ids = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return ids.length > 0 ? ids : null;
}

export function defaultContextTokens(raw: string): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CONTEXT_TOKENS;
}

function gameSystemLabel(gameSystem: string): string {
  const normalized = gameSystem.trim().toLowerCase();
  if (normalized === "ironsworn") return "Ironsworn";
  if (normalized === "starforged") return "Starforged";
  return gameSystem.trim() || "Ironsworn";
}

export function systemPrompt(gameSystem: string): string {
  const label = gameSystemLabel(gameSystem);
  return (
    `You are the GM assistant for an ${label} play-by-post campaign. ` +
    `You only draft: suggest scenes, dialogue and ideas the GM may use, ` +
    `change or discard. You never post, change or decide anything yourself; ` +
    `the GM decides what to use.`
  );
}
