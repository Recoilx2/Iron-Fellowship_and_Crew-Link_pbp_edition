// Main service for the Edge Runtime container.
//
// Routes /gm-assistant/* to the GM assistant proxy (spec #10); every other
// /functions/v1/* request gets a 404 with a stable, machine-readable body so
// operators can tell "no such function" apart from "gateway or runtime down"
// (the smoke test and CI probe rely on that code). The route list is shared
// with the handler and the browser client (protocol.ts, ticket #151), so
// the three sides cannot drift.
import { createGmAssistantHandler } from "../gm-assistant/handler.ts";
import { isGmAssistantPath } from "../gm-assistant/protocol.ts";

const handleGmAssistant = createGmAssistantHandler({
  endpoint: Deno.env.get("GM_ASSISTANT_ENDPOINT") ?? "",
  apiKey: Deno.env.get("GM_ASSISTANT_API_KEY") ?? "",
  allowedModels: Deno.env.get("GM_ASSISTANT_ALLOWED_MODELS") ?? "",
  contextTokens: Deno.env.get("GM_ASSISTANT_CONTEXT_TOKENS") ?? "",
  jwtSecret: Deno.env.get("JWT_SECRET") ?? "",
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  siteUrl: Deno.env.get("SITE_URL") ?? "",
  gameSystem: Deno.env.get("GAME_SYSTEM") ?? "",
});

Deno.serve((req: Request): Promise<Response> => {
  const { pathname } = new URL(req.url);
  if (isGmAssistantPath(pathname)) {
    return handleGmAssistant(req);
  }
  // OPTIONS on any other /gm-assistant/* path still reaches the handler,
  // which answers preflight refusals with a bodyless 404.
  if (req.method === "OPTIONS" && pathname.startsWith("/gm-assistant/")) {
    return handleGmAssistant(req);
  }
  if (req.method === "OPTIONS" && pathname.startsWith("/gm-assistant/")) {
    return handleGmAssistant(req);
  }
  return Promise.resolve(
    Response.json(
      {
        code: "FUNCTIONS_NOT_CONFIGURED",
        message: "No server functions are deployed yet",
      },
      { status: 404 },
    ),
  );
});
