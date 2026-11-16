/**
 * The chat turn (spec #10, tickets #129, #132): saves the GM's message,
 * builds the context from the GM's saved references (never from the
 * request body), calls the configured OpenAI-compatible endpoint and
 * streams the reply back as server-sent events, saving the reply —
 * including a partial one after a stop or a hang-up — to
 * `assistant_messages`. Split out of `handler.ts` (ticket #151).
 *
 * Security: every read and write carries the caller's JWT; the API key is
 * only ever sent upstream; errors carry only a generic message plus a
 * correlation ID.
 */
import {
  OUTLINE_PROPOSAL_BEGIN,
  OUTLINE_PROPOSAL_END,
  type AssistantRequestMode,
} from "./protocol.ts";
import type { GmAssistantEnv, UpstreamFetch } from "./env.ts";
import { systemPrompt } from "./env.ts";
import { errorName, errorResponse, corsHeaders } from "./http.ts";
import { mintReference, UUID_PATTERN, type VerifiedCaller } from "./security.ts";
import { postgrest } from "./postgrest.ts";
import { fetchUpstreamModels } from "./upstream.ts";
import {
  buildAssistantContext,
  readSavedContext,
  type BuiltAssistantContext,
} from "./context.ts";
import type { GmAssistantHandlerOptions } from "./handlerOptions.ts";

const DEFAULT_HEARTBEAT_MS = 3000;

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
    `assistant_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&select=role,content&order=created_at.desc,id.desc&limit=100`,
    fetchImpl,
  );
  if (status !== 200) return null;
  const history: ChatMessage[] = [];
  // Newest 100 come back newest first; the model wants oldest first.
  for (const row of [...rows].reverse()) {
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

export function outlineRevisionInstruction(): string {
  return (
    `The GM asked to revise the campaign outline. Return the complete ` +
    `replacement outline wrapped between ${OUTLINE_PROPOSAL_BEGIN} and ` +
    `${OUTLINE_PROPOSAL_END} on their own lines, with nothing else outside ` +
    `the markers.`
  );
}

interface ChatRequestBody {
  conversationId: string;
  message: string;
  mode: AssistantRequestMode;
}

function parseChatBody(body: unknown): ChatRequestBody | null {
  if (!body || typeof body !== "object") return null;
  const { conversationId, message, mode } = body as Record<string, unknown>;
  if (typeof conversationId !== "string" || !UUID_PATTERN.test(conversationId)) {
    return null;
  }
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 20000) return null;
  if (mode !== undefined && mode !== "chat" && mode !== "outline-revision") {
    return null;
  }
  return {
    conversationId,
    message: trimmed,
    mode: mode === "outline-revision" ? "outline-revision" : "chat",
  };
}

export async function handleChat(
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

  // The context is built here, on the server, from the GM's saved
  // references at request time. The request body carries no context text:
  // parseChatBody drops every other field, so anything context-like the
  // browser sends never reaches the model. An outline revision always
  // includes the current outline, whatever the saved choice says: the
  // server reads it and asks for a complete marked replacement.
  let built: BuiltAssistantContext;
  try {
    const choice = await readSavedContext(env, callerToken, caller.sub, conversation.campaignId, fetchImpl);
    if (chat.mode === "outline-revision") {
      choice.includeOutline = true;
    }
    built = await buildAssistantContext(env, callerToken, caller.sub, conversation.campaignId, choice, fetchImpl);
  } catch (error) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `context build failed (${errorName(error)})`);
  }

  const outgoing = [
    { role: "system", content: systemPrompt(env.gameSystem) },
    ...(built.text
      ? [{ role: "system", content: `Campaign context chosen by the GM:\n\n${built.text}` }]
      : []),
    ...(chat.mode === "outline-revision"
      ? [{ role: "system", content: outlineRevisionInstruction() }]
      : []),
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
      `upstream chat failed (${errorName(error)})`,
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
