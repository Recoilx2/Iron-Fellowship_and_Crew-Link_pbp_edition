/**
 * GM assistant edge-function handler (spec #10, ticket #129).
 *
 * Pure web-standard request handler: no Deno or Node APIs, so the same file
 * runs in the Edge Runtime (wired up by `supabase/functions/main/index.ts`)
 * and in the repo's vitest suite with an injected upstream fetch. It proxies
 * to the operator-configured OpenAI-compatible endpoint:
 *
 * - `GET /gm-assistant/models?campaignId=<uuid>` lists the endpoint's models
 *   filtered by `GM_ASSISTANT_ALLOWED_MODELS`, each with an approximate
 *   context size.
 * - `POST /gm-assistant/chat` takes `{ conversationId, message }`, saves the
 *   GM's message and the streamed reply to `assistant_messages`, and streams
 *   the reply back as server-sent events.
 *
 * Security: the caller's JWT is verified in code (the gateway's VERIFY_JWT
 * flag is off) and GM membership is checked before anything else. Every
 * database read and write goes through PostgREST with the caller's JWT, so
 * the row-level security rules stay the only gate; the service role is never
 * used. The API key never appears in a response or log. Errors carry only a
 * generic message plus a correlation ID.
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

export type UpstreamFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Handler options; `heartbeatMs` is a test seam, production uses the default. */
export interface GmAssistantHandlerOptions {
  /**
   * Milliseconds between SSE comment heartbeats (`: ping`) while a reply
   * streams. Heartbeats let the runtime notice a hung-up browser even when
   * the upstream sends nothing, and they defeat proxy idle timeouts on slow
   * models. Browsers and the repo's SSE parsers ignore comment lines.
   */
  heartbeatMs?: number;
}

const DEFAULT_HEARTBEAT_MS = 3000;

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const DEFAULT_CONTEXT_TOKENS = 8192;

function mintReference(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((b) => "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 32])
    .join("");
}

function base64UrlDecodeToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface VerifiedCaller {
  sub: string;
}

async function verifyCaller(
  req: Request,
  env: GmAssistantEnv,
): Promise<VerifiedCaller | null> {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  let headerJson: { alg?: string };
  let payload: { role?: string; exp?: number; sub?: string };
  try {
    headerJson = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToBytes(headerB64)),
    );
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToBytes(payloadB64)),
    );
  } catch {
    return null;
  }
  if (!headerJson || headerJson.alg !== "HS256") return null;
  if (!env.jwtSecret) return null;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecodeToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  if (!payload || payload.role !== "authenticated") return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    return null;
  }
  if (typeof payload.sub !== "string" || !UUID_PATTERN.test(payload.sub)) {
    return null;
  }
  return { sub: payload.sub };
}

function corsHeaders(req: Request, env: GmAssistantEnv): Headers {
  const headers = new Headers();
  const origin = req.headers.get("origin");
  if (origin && env.siteUrl && origin === env.siteUrl) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function errorResponse(
  req: Request,
  env: GmAssistantEnv,
  status: number,
  code: string,
  message: string,
  ref: string,
  detailForLog?: string,
): Response {
  if (detailForLog) {
    console.error(`[gm-assistant] ${ref} ${code}: ${detailForLog}`);
  }
  const headers = corsHeaders(req, env);
  headers.set("Content-Type", "application/json");
  return Response.json({ code, message, ref }, { status, headers });
}

function parseAllowedModels(raw: string): string[] | null {
  const ids = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return ids.length > 0 ? ids : null;
}

function defaultContextTokens(raw: string): number {
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

interface PostgrestOptions {
  method?: string;
  body?: unknown;
  prefer?: string;
}

async function postgrest(
  env: GmAssistantEnv,
  callerToken: string,
  path: string,
  fetchImpl: UpstreamFetch,
  options?: PostgrestOptions,
): Promise<{ status: number; rows: Array<Record<string, unknown>> }> {
  const headers = new Headers();
  headers.set("apikey", env.anonKey);
  headers.set("Authorization", `Bearer ${callerToken}`);
  if (options?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options?.prefer) headers.set("Prefer", options.prefer);
  const response = await fetchImpl(
    `${env.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path}`,
    {
      method: options?.method ?? "GET",
      headers,
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  const text = await response.text();
  let rows: Array<Record<string, unknown>> = [];
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      rows = Array.isArray(parsed)
        ? (parsed as Array<Record<string, unknown>>)
        : [];
    } catch {
      rows = [];
    }
  }
  return { status: response.status, rows };
}

export interface AssistantModel {
  id: string;
  contextTokens: number;
}

async function fetchUpstreamModels(
  env: GmAssistantEnv,
  fetchImpl: UpstreamFetch,
): Promise<{ ok: true; models: AssistantModel[] } | { ok: false; detail: string }> {
  const fallback = defaultContextTokens(env.contextTokens);
  const allowList = parseAllowedModels(env.allowedModels);
  let response: Response;
  try {
    const headers = new Headers();
    if (env.apiKey.trim()) {
      headers.set("Authorization", `Bearer ${env.apiKey}`);
    }
    response = await fetchImpl(
      `${env.endpoint.replace(/\/+$/, "")}/models`,
      { headers },
    );
  } catch (error) {
    return {
      ok: false,
      detail: `models request failed: ${error instanceof Error ? error.message : "network error"}`,
    };
  }
  if (!response.ok) {
    return { ok: false, detail: `models upstream status ${response.status}` };
  }
  let data: Array<Record<string, unknown>> = [];
  try {
    const parsed: unknown = JSON.parse(await response.text());
    const list = (parsed as { data?: unknown }).data;
    data = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
  } catch {
    return { ok: false, detail: "models upstream body was not JSON" };
  }
  const models: AssistantModel[] = [];
  for (const entry of data) {
    if (!entry || typeof entry.id !== "string" || !entry.id) continue;
    if (allowList && !allowList.includes(entry.id)) continue;
    const reported =
      typeof entry.context_length === "number" && entry.context_length > 0
        ? Math.trunc(entry.context_length)
        : typeof entry.contextLength === "number" && entry.contextLength > 0
          ? Math.trunc(entry.contextLength)
          : fallback;
    models.push({ id: entry.id, contextTokens: reported });
  }
  return { ok: true, models };
}

async function isCampaignGm(
  env: GmAssistantEnv,
  callerToken: string,
  userId: string,
  campaignId: string,
  fetchImpl: UpstreamFetch,
): Promise<boolean> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `campaign_members?campaign_id=eq.${encodeURIComponent(campaignId)}&user_id=eq.${encodeURIComponent(userId)}&select=role`,
    fetchImpl,
  );
  if (status !== 200) return false;
  return rows.some((row) => row.role === "gm");
}

interface ConversationLookup {
  id: string;
  campaignId: string;
}

async function lookupConversation(
  env: GmAssistantEnv,
  callerToken: string,
  conversationId: string,
  fetchImpl: UpstreamFetch,
): Promise<ConversationLookup | null> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `assistant_conversations?id=eq.${encodeURIComponent(conversationId)}&select=id,campaign_id`,
    fetchImpl,
  );
  if (status !== 200 || rows.length === 0) return null;
  const row = rows[0] as { id?: unknown; campaign_id?: unknown };
  if (typeof row.id !== "string" || typeof row.campaign_id !== "string") {
    return null;
  }
  return { id: row.id, campaignId: row.campaign_id };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

async function readHistory(
  env: GmAssistantEnv,
  callerToken: string,
  conversationId: string,
  fetchImpl: UpstreamFetch,
): Promise<ChatMessage[] | null> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `assistant_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&select=role,content&order=created_at.asc&order=id.asc&limit=100`,
    fetchImpl,
  );
  if (status !== 200) return null;
  const history: ChatMessage[] = [];
  for (const row of rows) {
    if (
      (row.role === "user" || row.role === "assistant") &&
      typeof row.content === "string"
    ) {
      history.push({ role: row.role, content: row.content });
    }
  }
  return history;
}

async function readSavedModel(
  env: GmAssistantEnv,
  callerToken: string,
  userId: string,
  campaignId: string,
  fetchImpl: UpstreamFetch,
): Promise<string | null> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `assistant_settings?campaign_id=eq.${encodeURIComponent(campaignId)}&gm_id=eq.${encodeURIComponent(userId)}&select=model`,
    fetchImpl,
  );
  if (status !== 200 || rows.length === 0) return null;
  const model = (rows[0] as { model?: unknown }).model;
  return typeof model === "string" && model.trim() ? model.trim() : null;
}

async function saveMessage(
  env: GmAssistantEnv,
  callerToken: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  stoppedPartway: boolean,
  fetchImpl: UpstreamFetch,
): Promise<boolean> {
  const { status } = await postgrest(
    env,
    callerToken,
    "assistant_messages?select=id",
    fetchImpl,
    {
      method: "POST",
      prefer: "return=representation",
      body: {
        conversation_id: conversationId,
        role,
        content,
        stopped_partway: stoppedPartway,
      },
    },
  );
  return status === 200 || status === 201;
}

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ content })}\n\n`;
}

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
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `gm check failed: ${error instanceof Error ? error.message : "unknown"}`);
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
      models: result.models.map((model) => ({
        id: model.id,
        context_tokens: model.contextTokens,
      })),
    },
    { headers },
  );
}

interface ChatRequestBody {
  conversationId: string;
  message: string;
}

function parseChatBody(body: unknown): ChatRequestBody | null {
  if (!body || typeof body !== "object") return null;
  const { conversationId, message } = body as Record<string, unknown>;
  if (typeof conversationId !== "string" || !UUID_PATTERN.test(conversationId)) {
    return null;
  }
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 20000) return null;
  return { conversationId, message: trimmed };
}

async function handleChat(
  req: Request,
  env: GmAssistantEnv,
  caller: VerifiedCaller,
  callerToken: string,
  fetchImpl: UpstreamFetch,
  options?: GmAssistantHandlerOptions,
): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await req.text());
  } catch {
    parsed = null;
  }
  const chat = parseChatBody(parsed);
  if (!chat) {
    return errorResponse(
      req,
      env,
      400,
      "INVALID_REQUEST",
      "That request was not valid.",
      mintReference(),
    );
  }
  // The conversation lookup runs with the caller's JWT, so anyone who is
  // not the owning GM of its campaign sees nothing and gets the same
  // answer as for a conversation that does not exist. Only after that
  // ownership check does the not-set-up answer come back.
  const conversation = await lookupConversation(
    env,
    callerToken,
    chat.conversationId,
    fetchImpl,
  );
  if (!conversation) {
    return errorResponse(
      req,
      env,
      404,
      "CONVERSATION_NOT_FOUND",
      "That conversation was not found.",
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
  const history = await readHistory(env, callerToken, conversation.id, fetchImpl);
  if (!history) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, "history read failed");
  }
  const savedModel = await readSavedModel(
    env,
    callerToken,
    caller.sub,
    conversation.campaignId,
    fetchImpl,
  );
  const modelsResult = await fetchUpstreamModels(env, fetchImpl);
  if (!modelsResult.ok) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, modelsResult.detail);
  }
  const available = modelsResult.models;
  const chosen =
    (savedModel && available.some((model) => model.id === savedModel)
      ? savedModel
      : null) ?? available[0]?.id;
  if (!chosen) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, "no usable model");
  }
  const userSaved = await saveMessage(
    env,
    callerToken,
    conversation.id,
    "user",
    chat.message,
    false,
    fetchImpl,
  );
  if (!userSaved) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, "user message save failed");
  }

  const outgoing = [
    { role: "system", content: systemPrompt(env.gameSystem) },
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: chat.message },
  ];

  const upstreamAbort = new AbortController();
  const onClientAbort = (): void => upstreamAbort.abort();
  if (req.signal.aborted) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, "client gone before upstream start");
  }
  req.signal.addEventListener("abort", onClientAbort, { once: true });

  let upstream: Response;
  try {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    if (env.apiKey.trim()) {
      headers.set("Authorization", `Bearer ${env.apiKey}`);
    }
    upstream = await fetchImpl(
      `${env.endpoint.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ model: chosen, messages: outgoing, stream: true }),
        signal: upstreamAbort.signal,
      },
    );
  } catch (error) {
    req.signal.removeEventListener("abort", onClientAbort);
    // The client is gone or the network failed: keep the partial reply (if
    // any text arrived it is saved by the stream finalizer; here nothing
    // arrived yet) and report the generic failure.
    const ref = mintReference();
    return errorResponse(
      req,
      env,
      502,
      "UPSTREAM_ERROR",
      "The assistant request failed.",
      ref,
      `upstream chat failed: ${error instanceof Error ? error.message : "network error"}`,
    );
  }
  if (!upstream.ok || !upstream.body) {
    req.signal.removeEventListener("abort", onClientAbort);
    upstreamAbort.abort();
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `upstream chat status ${upstream.status}`);
  }

  const headers = corsHeaders(req, env);
  headers.set("Content-Type", "text/event-stream");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");

  let settled = false;
  const finish = (reply: string, stopped: boolean): Promise<void> => {
    if (settled) return Promise.resolve();
    settled = true;
    req.signal.removeEventListener("abort", onClientAbort);
    // An empty reply carries nothing to keep (and the table requires
    // non-blank content), so only non-empty replies are stored.
    if (!reply) return Promise.resolve();
    return saveMessage(
      env,
      callerToken,
      conversation.id,
      "assistant",
      reply,
      stopped,
      fetchImpl,
    ).then(
      (saved) => {
        if (!saved) {
          console.error(`[gm-assistant] reply save failed for ${conversation.id}`);
        }
      },
      () => undefined,
    );
  };

  const rawHeartbeat = options?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const heartbeatMs =
    Number.isFinite(rawHeartbeat) && rawHeartbeat > 0
      ? rawHeartbeat
      : DEFAULT_HEARTBEAT_MS;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stopHeartbeat = (): void => {
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  };
  // Assigned when the stream starts; lets `cancel()` unblock a parked
  // `reader.read()` even where aborting the upstream fetch is not enough.
  let cancelReader: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const reader = upstream.body!.getReader();
      cancelReader = (): void => {
        reader.cancel().catch(() => undefined);
      };
      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      let clientGone = false;
      // The runtime only learns that the browser hung up when the function
      // next writes, so a stalled upstream would leave this stream parked in
      // `reader.read()` forever. Heartbeat comments force a write every few
      // seconds: after a hang-up the write fails (or the runtime cancels the
      // stream), `cancel()` aborts the upstream, and the partial reply is
      // saved as stopped.
      const onAbort = (): void => {
        clientGone = true;
        upstreamAbort.abort();
        stopHeartbeat();
        cancelReader?.();
      };
      req.signal.addEventListener("abort", onAbort, { once: true });
      heartbeat = setInterval(() => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          onAbort();
        }
      }, heartbeatMs);
      // Test runners (Node) hold the process for active intervals; the
      // Edge Runtime has no `unref`, so this is a no-op there.
      (heartbeat as unknown as { unref?: () => void }).unref?.();
      const enqueue = (text: string): void => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          clientGone = true;
        }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice("data:".length).trim();
            if (payload === "[DONE]") continue;
            try {
              const parsedLine = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: unknown } }>;
              };
              const content = parsedLine.choices?.[0]?.delta?.content;
              if (typeof content === "string" && content) {
                reply += content;
                if (!clientGone) enqueue(sseChunk(content));
              }
            } catch {
              continue;
            }
          }
          if (clientGone) break;
        }
        buffer += decoder.decode();
      } catch {
        clientGone = true;
      } finally {
        stopHeartbeat();
        cancelReader = undefined;
        req.signal.removeEventListener("abort", onAbort);
        try {
          if (!clientGone) enqueue("data: [DONE]\n\n");
          controller.close();
        } catch {
          clientGone = true;
        }
        await finish(reply, clientGone || req.signal.aborted);
      }
    },
    cancel() {
      // Fires when the runtime drops the response stream (browser hang-up
      // noticed on a heartbeat write). Abort the upstream so the fake (and
      // the live test) observes the hang-up and the partial reply is kept.
      stopHeartbeat();
      upstreamAbort.abort();
      cancelReader?.();
    },
  });

  return new Response(stream, { headers });
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
      if (url.pathname === "/gm-assistant/models" || url.pathname === "/gm-assistant/chat") {
        const headers = corsHeaders(req, env);
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.set(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type",
        );
        headers.set("Access-Control-Max-Age", "86400");
        return new Response(null, { status: 204, headers });
      }
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
    if (req.method === "GET" && url.pathname === "/gm-assistant/models") {
      return handleModels(req, env, caller, callerToken, fetchImpl);
    }
    if (req.method === "POST" && url.pathname === "/gm-assistant/chat") {
      return handleChat(req, env, caller, callerToken, fetchImpl, options);
    }
    const headers = corsHeaders(req, env);
    headers.set("Content-Type", "application/json");
    return Response.json(
      {
        code: "FUNCTIONS_NOT_CONFIGURED",
        message: "No server functions are deployed yet",
      },
      { status: 404, headers },
    );
  };
}
