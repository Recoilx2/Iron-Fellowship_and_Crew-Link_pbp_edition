import { getSupabaseClient } from "config/supabase.config";
import { mintErrorReference } from "functions/errorReference";

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
  }
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
  message?: unknown;
  ref?: unknown;
}

async function throwForStatus(
  response: Response,
  fallbackMessage: string
): Promise<never> {
  let code = "UPSTREAM_ERROR";
  let message = fallbackMessage;
  let ref: string | null = null;
  try {
    const parsed = (await response.json()) as ErrorBody;
    if (typeof parsed.code === "string" && parsed.code) {
      code = parsed.code;
    }
    if (typeof parsed.message === "string" && parsed.message) {
      message = parsed.message;
    }
    if (typeof parsed.ref === "string" && parsed.ref) {
      ref = parsed.ref;
    }
  } catch {
    // A non-JSON failure still reports generically with a minted reference.
    ref = mintErrorReference();
  }
  if (!ref && response.status !== 401) {
    ref = ref ?? mintErrorReference();
  }
  throw new AssistantRequestError(code, message, {
    status: response.status,
    ref,
  });
}

/**
 * Lists the models the server offers for a campaign, each with an
 * approximate context size. Throws AssistantRequestError with code
 * NOT_SET_UP when the operator has not configured a model server.
 */
export async function fetchAssistantModels(
  campaignId: string,
  options?: { signal?: AbortSignal }
): Promise<AssistantModelOption[]> {
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
    throw new AssistantRequestError(
      "NETWORK_ERROR",
      "The assistant request failed.",
      { status: 0, ref: mintErrorReference() }
    );
  }
  if (!response.ok) {
    await throwForStatus(response, "The assistant request failed.");
  }
  const parsed = (await response.json()) as {
    models?: Array<{ id?: unknown; context_tokens?: unknown }>;
  };
  const models = Array.isArray(parsed.models) ? parsed.models : [];
  return models
    .filter((entry) => typeof entry.id === "string" && entry.id)
    .map((entry) => ({
      id: entry.id as string,
      contextTokens:
        typeof entry.context_tokens === "number" && entry.context_tokens > 0
          ? Math.trunc(entry.context_tokens)
          : 8192,
    }));
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
  signal: AbortSignal;
  onChunk: (content: string) => void;
}): Promise<AssistantStreamResult> {
  const { conversationId, message, signal, onChunk } = args;
  let response: Response;
  try {
    const headers = await authHeaders();
    headers.set("Content-Type", "application/json");
    response = await fetch(`${functionsBaseUrl()}/gm-assistant/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ conversationId, message }),
      signal,
    });
  } catch (error) {
    if (error instanceof AssistantRequestError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return { text: "", aborted: true };
    }
    throw new AssistantRequestError(
      "NETWORK_ERROR",
      "The assistant request failed.",
      { status: 0, ref: mintErrorReference() }
    );
  }
  if (!response.ok) {
    await throwForStatus(response, "The assistant request failed.");
  }
  if (!response.body) {
    throw new AssistantRequestError(
      "NETWORK_ERROR",
      "The assistant request failed.",
      { status: 0, ref: mintErrorReference() }
    );
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
    throw new AssistantRequestError(
      "NETWORK_ERROR",
      "The assistant request failed.",
      { status: 0, ref: mintErrorReference() }
    );
  } finally {
    reader.releaseLock();
  }
  return { text, aborted: signal.aborted };
}
