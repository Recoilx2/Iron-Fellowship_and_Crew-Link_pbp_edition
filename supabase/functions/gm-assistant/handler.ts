/**
 * GM assistant edge-function handler — the router (spec #10, ticket
 * #129). Pure web-standard request handler: no Deno or Node APIs, so the
 * same file runs in the Edge Runtime (wired up by
 * `supabase/functions/main/index.ts`) and in the repo's vitest suite with
 * an injected upstream fetch. It proxies to the operator-configured
 * OpenAI-compatible endpoint:
 *
 * - `GET /gm-assistant/models?campaignId=<uuid>` lists the endpoint's models
 *   filtered by `GM_ASSISTANT_ALLOWED_MODELS`, each with an approximate
 *   context size.
 * - `GET /gm-assistant/context-size?campaignId=<uuid>` builds the GM's
 *   saved context server-side (the same code the chat path uses) and
 *   returns per-item sizes plus the references it had to skip, so the
 *   panel can show roughly how big each piece is without ever seeing text
 *   it may not read.
 *   `POST /gm-assistant/context-size` with `{ campaignId, context }` sizes a
 *   preview list of references the same way in one batch (ticket #149), so
 *   the Context tab can show a size beside every candidate before it is
 *   ticked; nothing is saved.
 * - `POST /gm-assistant/chat` takes `{ conversationId, message }`, saves the
 *   GM's message and the streamed reply to `assistant_messages`, and streams
 *   the reply back as server-sent events. An optional
 *   `mode: "outline-revision"` always includes the current outline and asks
 *   for a complete replacement between `<<<OUTLINE-BEGIN>>>` and
 *   `<<<OUTLINE-END>>>` markers, so the client can preview it side by side.
 *
 * Assistant context (ticket #132): the GM picks references (the outline,
 * world entries with an optional GM-only part, notes, channels with a post
 * count) saved per GM per campaign in `assistant_settings`. The server
 * builds the actual context text from those references at request time,
 * reading every row through PostgREST with the caller's JWT so the
 * row-level security rules stay the only gate: a reference the GM can no
 * longer read (a deleted entry, or a direct message they are not in) reads
 * as missing and is skipped, never leaked. A GM-only part is included only
 * when its toggle is on. Anything context-like the browser sends is
 * ignored: the request body carries only the conversation and the message.
 * Note text is stored as Yjs updates (the note server's format, base64
 * beside each note); the function decodes it to plain text, reusing that
 * format instead of a second copy of the text. Sizes are characters
 * converted to approximate tokens (four characters per token); exact
 * per-model tokenising is not needed, and the same function sizes both the
 * context-size answer and the chat text.
 *
 * Security: the caller's JWT is verified in code (the gateway's VERIFY_JWT
 * flag is off) and GM membership is checked before anything else. Every
 * database read and write goes through PostgREST with the caller's JWT, so
 * the row-level security rules stay the only gate; the service role is never
 * used. The API key never appears in a response or log. Errors carry only a
 * generic message plus a correlation ID.
 *
 * Split along its jobs (ticket #151): `env.ts` holds the deployment config
 * and prompts, `security.ts` the JWT and GM checks, `http.ts` the CORS and
 * error contract, `postgrest.ts` the database edge, `yjsText.ts` the note
 * decoder, `upstream.ts` the model calls, `context.ts` the context
 * building and `chat.ts` the streamed chat turn. This file is the route
 * table and the two smaller routes; it re-exports the shared names the
 * tests import.
 */
import {
  approximateTokensForChars,
  isGmAssistantPath,
  GM_ASSISTANT_CHAT_PATH,
  GM_ASSISTANT_CONTEXT_SIZE_PATH,
  GM_ASSISTANT_MODELS_PATH,
  type AssistantContextChoice,
} from "./protocol.ts";
import type { GmAssistantEnv, UpstreamFetch } from "./env.ts";
import { systemPrompt } from "./env.ts";
import { corsHeaders, errorName, errorResponse, readBodyCapped } from "./http.ts";
import {
  isCampaignGm,
  mintReference,
  UUID_PATTERN,
  verifyCaller,
  type VerifiedCaller,
} from "./security.ts";
import { endpointHostOf, fetchUpstreamModels } from "./upstream.ts";
import {
  buildAssistantContext,
  normalizeContextChoice,
  readSavedContext,
} from "./context.ts";
import { handleChat } from "./chat.ts";
import type { GmAssistantHandlerOptions } from "./handlerOptions.ts";

// Shared wire protocol (ticket #151): re-exported here so tests and live
// tests keep their single import site.
export {
  approximateTokensForChars,
  extractOutlineProposal,
  OUTLINE_PROPOSAL_BEGIN,
  OUTLINE_PROPOSAL_END,
  type AssistantChannelReference,
  type AssistantContextChoice,
  type AssistantItemReference,
  type AssistantRequestMode,
} from "./protocol.ts";
export { yjsBase64ToPlainText } from "./yjsText.ts";
export { systemPrompt } from "./env.ts";
export type { GmAssistantEnv, UpstreamFetch } from "./env.ts";
export type { GmAssistantHandlerOptions } from "./handlerOptions.ts";

/** Largest preview body accepted: 100 references x 5 kinds is well under it. */
const MAX_PREVIEW_BODY_BYTES = 64 * 1024;

async function handleModels(
  req: Request,
  env: GmAssistantEnv,
  caller: VerifiedCaller,
  callerToken: string,
  fetchImpl: UpstreamFetch,
): Promise<Response> {
  const campaignId = new URL(req.url).searchParams.get("campaignId") ?? "";
  if (!UUID_PATTERN.test(campaignId)) {
    return errorResponse(
      req,
      env,
      400,
      "INVALID_REQUEST",
      "That request was not valid.",
      mintReference(),
    );
  }
  let gm = false;
  try {
    gm = await isCampaignGm(env, callerToken, caller.sub, campaignId, fetchImpl);
  } catch (error) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `gm check failed (${errorName(error)})`);
  }
  if (!gm) {
    return errorResponse(
      req,
      env,
      403,
      "FORBIDDEN",
      "Only the campaign's GMs can use the assistant.",
      mintReference(),
    );
  }
  if (!env.endpoint.trim()) {
    return errorResponse(
      req,
      env,
      503,
      "NOT_SET_UP",
      "The GM assistant is not set up on this server.",
      mintReference(),
    );
  }
  const result = await fetchUpstreamModels(env, fetchImpl);
  if (!result.ok) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, result.detail);
  }
  const headers = corsHeaders(req, env);
  headers.set("Content-Type", "application/json");
  return Response.json(
    {
      endpointHost: endpointHostOf(env.endpoint),
      models: result.models.map((model) => ({
        id: model.id,
        context_tokens: model.contextTokens,
      })),
    },
    { headers },
  );
}

async function handleContextSize(
  req: Request,
  env: GmAssistantEnv,
  caller: VerifiedCaller,
  callerToken: string,
  fetchImpl: UpstreamFetch,
): Promise<Response> {
  // POST sizes a preview list of references in one batch (the Context tab's
  // candidates); GET sizes the GM's saved context.
  let campaignId = new URL(req.url).searchParams.get("campaignId") ?? "";
  let preview: AssistantContextChoice | null = null;
  if (req.method === "POST") {
    const tooLarge = () =>
      errorResponse(req, env, 413, "PAYLOAD_TOO_LARGE", "That request was too large.", mintReference());
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PREVIEW_BODY_BYTES) return tooLarge();
    // The body is read with a cap that holds while it streams, so the limit
    // also holds for chunked bodies with no Content-Length (ticket #163):
    // nothing past 64 KB is ever buffered.
    let raw: string | null = null;
    let body: unknown;
    try {
      raw = await readBodyCapped(req, MAX_PREVIEW_BODY_BYTES);
    } catch {
      raw = null;
    }
    if (raw === null) return tooLarge();
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    campaignId = typeof record?.campaignId === "string" ? record.campaignId : "";
    preview = record ? normalizeContextChoice(record.context) : null;
  }
  if (!UUID_PATTERN.test(campaignId) || (req.method === "POST" && !preview)) {
    return errorResponse(
      req,
      env,
      400,
      "INVALID_REQUEST",
      "That request was not valid.",
      mintReference(),
    );
  }
  let gm = false;
  try {
    gm = await isCampaignGm(env, callerToken, caller.sub, campaignId, fetchImpl);
  } catch (error) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `gm check failed (${errorName(error)})`);
  }
  if (!gm) {
    return errorResponse(
      req,
      env,
      403,
      "FORBIDDEN",
      "Only the campaign's GMs can use the assistant.",
      mintReference(),
    );
  }
  // The same code the chat path uses, so the sizes always match the text
  // the model would receive. Every reference it cannot read is skipped and
  // reported, never leaked.
  try {
    const choice =
      preview ?? (await readSavedContext(env, callerToken, caller.sub, campaignId, fetchImpl));
    const built = await buildAssistantContext(env, callerToken, caller.sub, campaignId, choice, fetchImpl);
    const instructionChars = systemPrompt(env.gameSystem).length;
    const headers = corsHeaders(req, env);
    headers.set("Content-Type", "application/json");
    return Response.json(
      {
        items: built.items,
        totalChars: built.totalChars,
        totalTokens: built.totalTokens,
        instructionChars,
        instructionTokens: approximateTokensForChars(instructionChars),
        unavailable: built.unavailable,
      },
      { headers },
    );
  } catch (error) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `context build failed (${errorName(error)})`);
  }
}

/**
 * Builds the GM assistant request handler. `fetchImpl` performs both the
 * PostgREST calls (with the caller's JWT) and the upstream model calls
 * (with the server-side key); tests inject a fake, the runtime passes fetch.
 */
export function createGmAssistantHandler(
  env: GmAssistantEnv,
  fetchImpl: UpstreamFetch = fetch,
  options?: GmAssistantHandlerOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      if (isGmAssistantPath(url.pathname)) {
        const headers = corsHeaders(req, env);
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.set(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type",
        );
        headers.set("Access-Control-Max-Age", "86400");
        return new Response(null, { status: 204, headers });
      }
      // Deliberately exempt from the one-line error log: a bodyless CORS
      // preflight refusal has no reference to show anyone.
      return new Response(null, { status: 404 });
    }
    const callerToken = (() => {
      const header = req.headers.get("authorization");
      const match = header ? /^Bearer (.+)$/.exec(header.trim()) : null;
      return match ? match[1] : null;
    })();
    const caller = await verifyCaller(req, env);
    if (!caller || !callerToken) {
      return errorResponse(
        req,
        env,
        401,
        "UNAUTHORIZED",
        "Sign in again and retry.",
        mintReference(),
      );
    }
    try {
      if (req.method === "GET" && url.pathname === GM_ASSISTANT_MODELS_PATH) {
        return await handleModels(req, env, caller, callerToken, fetchImpl);
      }
      if (
        (req.method === "GET" || req.method === "POST") &&
        url.pathname === GM_ASSISTANT_CONTEXT_SIZE_PATH
      ) {
        return await handleContextSize(req, env, caller, callerToken, fetchImpl);
      }
      if (req.method === "POST" && url.pathname === GM_ASSISTANT_CHAT_PATH) {
        return await handleChat(req, env, caller, callerToken, fetchImpl, options);
      }
    } catch (error) {
      return errorResponse(
        req,
        env,
        502,
        "UPSTREAM_ERROR",
        "The assistant request failed.",
        mintReference(),
        `unhandled ${errorName(error)}`,
      );
    }
    return errorResponse(
      req,
      env,
      404,
      "FUNCTIONS_NOT_CONFIGURED",
      "No server functions are deployed yet",
      mintReference(),
    );
  };
}
