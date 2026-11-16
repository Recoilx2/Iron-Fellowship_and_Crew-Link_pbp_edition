import { getSupabaseClient } from "config/supabase.config";
import {
  logFailureReference,
  mintErrorReference,
  rememberReference,
} from "functions/errorReference";
import type { AssistantContextChoice } from "./_assistant.type";

/**
 * Browser client for the GM assistant server function (spec #10). The
 * browser never sees the model endpoint or its key: it calls the stack's
 * own functions gateway, which proxies to the configured model server.
 * Every failure maps to a short generic error carrying the server's
 * reference code (or a minted one when the network itself fails), so the
 * panel can show it without ever exposing internal details.
 */

export interface AssistantModelOption {
  id: string;
  contextTokens: number;
}

export interface AssistantModelsResult {
  /** Host (and port) of the server's model endpoint; null when unknown. */
  endpointHost: string | null;
  models: AssistantModelOption[];
}

export interface AssistantContextSizeItem {
  key: string;
  label: string;
  chars: number;
  tokens: number;
}

export interface AssistantContextUnavailable {
  key: string;
  reason: string;
}

export interface AssistantContextSize {
  items: AssistantContextSizeItem[];
  totalChars: number;
  totalTokens: number;
  instructionChars: number;
  instructionTokens: number;
  unavailable: AssistantContextUnavailable[];
}

/**
 * Markers wrapping a complete replacement outline in an outline-revision
 * reply (ticket #133). Kept identical to the server function's markers in
 * `supabase/functions/gm-assistant/handler.ts`; the server asks the model
 * to put the replacement between them, and `extractOutlineProposal` pulls
 * it out for the side-by-side preview.
 */
export const OUTLINE_PROPOSAL_BEGIN = "<<<OUTLINE-BEGIN>>>";
export const OUTLINE_PROPOSAL_END = "<<<OUTLINE-END>>>";

/**
 * Pulls the proposed outline from an assistant reply: the text between
 * the first begin marker and the last end marker, trimmed. Null when the
 * reply carries no complete proposal.
 */
export function extractOutlineProposal(reply: string): string | null {
  const start = reply.indexOf(OUTLINE_PROPOSAL_BEGIN);
  const end = reply.lastIndexOf(OUTLINE_PROPOSAL_END);
  if (start < 0 || end < 0 || end <= start + OUTLINE_PROPOSAL_BEGIN.length) {
    return null;
  }
  const proposed = reply
    .slice(start + OUTLINE_PROPOSAL_BEGIN.length, end)
    .trim();
  return proposed.length > 0 ? proposed : null;
}

/** What the GM asked for: a normal chat turn or a dedicated outline revision. */
export type AssistantRequestMode = "chat" | "outline-revision";

/**
 * Approximate tokens for a character count: four characters per token,
 * rounded up. Kept identical to the server function (handler.ts); exact
 * per-model tokenising is not needed. The panel uses it for the
 * conversation overhead beside the server-sized context and instructions.
 */
export function approximateTokensForChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

export interface AssistantStreamResult {
  text: string;
  /** True when the caller aborted before the reply finished. */
  aborted: boolean;
}

export class AssistantRequestError extends Error {
  code: string;
  status: number;
  ref: string | null;

  constructor(
    code: string,
    message: string,
    options: { status: number; ref?: string | null }
  ) {
    super(message);
    this.name = "AssistantRequestError";
    this.code = code;
    this.status = options.status;
    this.ref = options.ref ?? null;
    if (this.ref) {
      rememberReference(this, this.ref);
    }
  }
}

const MODELS_PATH = "/gm-assistant/models";
const CONTEXT_SIZE_PATH = "/gm-assistant/context-size";
const CHAT_PATH = "/gm-assistant/chat";

/** A network-level failure: a minted reference, logged once with the path. */
function networkFailure(path: string): AssistantRequestError {
  const ref = mintErrorReference();
  logFailureReference(ref, `${path} network failure (status 0)`);
  return new AssistantRequestError(
    "NETWORK_ERROR",
    "The assistant request failed.",
    { status: 0, ref }
  );
}

function functionsBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) {
    throw new Error("Supabase is not configured.");
  }
  return `${url.replace(/\/+$/, "")}/functions/v1`;
}

async function authHeaders(init?: RequestInit): Promise<Headers> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new AssistantRequestError("UNAUTHORIZED", "Sign in again and retry.", {
      status: 401,
      ref: null,
    });
  }
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

interface ErrorBody {
  code?: unknown;
  ref?: unknown;
}

async function throwForStatus(
  response: Response,
  path: string,
  fallbackMessage: string
): Promise<never> {
  let code = "UPSTREAM_ERROR";
  let ref: string | null = null;
  let body = "";
  try {
    body = await response.text();
    const parsed = JSON.parse(body) as ErrorBody;
    if (typeof parsed.code === "string" && parsed.code) {
      code = parsed.code;
    }
    if (typeof parsed.ref === "string" && parsed.ref) {
      ref = parsed.ref;
    }
  } catch {
    // A non-JSON failure still reports generically with a minted reference.
  }
  if (!ref && response.status !== 401) {
    // The server never logged this one, so the client does, with the
    // gateway's own text kept out of the UI but in the log.
    ref = mintErrorReference();
    logFailureReference(
      ref,
      `${path} status ${response.status}`,
      body.slice(0, 500)
    );
  }
  // The server's or gateway's own text is never carried: the message is
  // always the fixed client text, and the panel maps the code to its own.
  throw new AssistantRequestError(code, fallbackMessage, {
    status: response.status,
    ref,
  });
}

/**
 * Lists the models the server offers for a campaign, each with an
 * approximate context size, plus the host (never credentials or path) of
 * the endpoint the server sends material to, or null when it isn't told. Throws AssistantRequestError with code
 * NOT_SET_UP when the operator has not configured a model server.
 */
export async function fetchAssistantModels(
  campaignId: string,
  options?: { signal?: AbortSignal }
): Promise<AssistantModelsResult> {
  let response: Response;
  try {
    const headers = await authHeaders();
    response = await fetch(
      `${functionsBaseUrl()}/gm-assistant/models?campaignId=${encodeURIComponent(campaignId)}`,
      { headers, signal: options?.signal }
    );
  } catch (error) {
    if (error instanceof AssistantRequestError) {
      throw error;
    }
    throw networkFailure(MODELS_PATH);
  }
  if (!response.ok) {
    await throwForStatus(response, MODELS_PATH, "The assistant request failed.");
  }
  const parsed = (await response.json()) as {
    endpointHost?: unknown;
    models?: Array<{ id?: unknown; context_tokens?: unknown }>;
  };
  const models = Array.isArray(parsed.models) ? parsed.models : [];
  return {
    endpointHost:
      typeof parsed.endpointHost === "string" && parsed.endpointHost
        ? parsed.endpointHost
        : null,
    models: models
      .filter((entry) => typeof entry.id === "string" && entry.id)
      .map((entry) => ({
        id: entry.id as string,
        contextTokens:
          typeof entry.context_tokens === "number" && entry.context_tokens > 0
            ? Math.trunc(entry.context_tokens)
            : 8192,
      })),
  };
}

/**
 * Asks the server how big the GM's saved context is for a campaign:
 * per-item sizes built by the same code the chat path uses, plus the
 * instruction overhead and the saved references it had to skip. Throws
 * AssistantRequestError with the server code otherwise. With `preview`,
 * sizes that list of references instead (one batched request; nothing is
 * saved), so every candidate can show a size before it is ticked.
 */
export async function fetchAssistantContextSize(
  campaignId: string,
  options?: { signal?: AbortSignal; preview?: AssistantContextChoice }
): Promise<AssistantContextSize> {
  let response: Response;
  try {
    const headers = await authHeaders();
    if (options?.preview) {
      // A preview list of references is sized in one batched POST.
      headers.set("Content-Type", "application/json");
      response = await fetch(`${functionsBaseUrl()}/gm-assistant/context-size`, {
        method: "POST",
        headers,
        body: JSON.stringify({ campaignId, context: options.preview }),
        signal: options.signal,
      });
    } else {
      response = await fetch(
        `${functionsBaseUrl()}/gm-assistant/context-size?campaignId=${encodeURIComponent(campaignId)}`,
        { headers, signal: options?.signal }
      );
    }
  } catch (error) {
    if (error instanceof AssistantRequestError) {
      throw error;
    }
    throw networkFailure(CONTEXT_SIZE_PATH);
  }
  if (!response.ok) {
    await throwForStatus(response, CONTEXT_SIZE_PATH, "The assistant request failed.");
  }
  const parsed = (await response.json()) as {
    items?: Array<{ key?: unknown; label?: unknown; chars?: unknown; tokens?: unknown }>;
    totalChars?: unknown;
    totalTokens?: unknown;
    instructionChars?: unknown;
    instructionTokens?: unknown;
    unavailable?: Array<{ key?: unknown; reason?: unknown }>;
  };
  const items = Array.isArray(parsed.items)
    ? parsed.items
        .filter(
          (entry) =>
            typeof entry.key === "string" &&
            typeof entry.label === "string" &&
            typeof entry.chars === "number" &&
            typeof entry.tokens === "number"
        )
        .map((entry) => ({
          key: entry.key as string,
          label: entry.label as string,
          chars: entry.chars as number,
          tokens: entry.tokens as number,
        }))
    : [];
  const unavailable = Array.isArray(parsed.unavailable)
    ? parsed.unavailable
        .filter(
          (entry) => typeof entry.key === "string" && typeof entry.reason === "string"
        )
        .map((entry) => ({ key: entry.key as string, reason: entry.reason as string }))
    : [];
  return {
    items,
    totalChars: typeof parsed.totalChars === "number" ? parsed.totalChars : 0,
    totalTokens: typeof parsed.totalTokens === "number" ? parsed.totalTokens : 0,
    instructionChars:
      typeof parsed.instructionChars === "number" ? parsed.instructionChars : 0,
    instructionTokens:
      typeof parsed.instructionTokens === "number" ? parsed.instructionTokens : 0,
    unavailable,
  };
}

/**
 * Sends one message and streams the reply back as server-sent events,
 * reporting each content chunk as it arrives. Resolves with the full
 * reply; when the caller aborts, the partial text resolves with
 * aborted=true so the panel can mark the reply stopped.
 */
export async function streamAssistantChat(args: {
  conversationId: string;
  message: string;
  /** Dedicated outline-revision mode: the server includes the current
   * outline and asks for a marked complete replacement. Defaults to chat. */
  mode?: AssistantRequestMode;
  signal: AbortSignal;
  onChunk: (content: string) => void;
}): Promise<AssistantStreamResult> {
  const { conversationId, message, mode, signal, onChunk } = args;
  let response: Response;
  try {
    const headers = await authHeaders();
    headers.set("Content-Type", "application/json");
    response = await fetch(`${functionsBaseUrl()}/gm-assistant/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        conversationId,
        message,
        ...(mode === "outline-revision" ? { mode } : {}),
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof AssistantRequestError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return { text: "", aborted: true };
    }
    throw networkFailure(CHAT_PATH);
  }
  if (!response.ok) {
    await throwForStatus(response, CHAT_PATH, "The assistant request failed.");
  }
  if (!response.body) {
    throw networkFailure(CHAT_PATH);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        // Heartbeat comments and the terminal marker carry no content.
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice("data:".length).trim();
        if (payload === "[DONE]") {
          continue;
        }
        try {
          const parsed = JSON.parse(payload) as { content?: unknown };
          if (typeof parsed.content === "string" && parsed.content) {
            text += parsed.content;
            onChunk(parsed.content);
          }
        } catch {
          continue;
        }
      }
      if (signal.aborted) {
        break;
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { text, aborted: true };
    }
    throw networkFailure(CHAT_PATH);
  } finally {
    reader.releaseLock();
  }
  return { text, aborted: signal.aborted };
}
