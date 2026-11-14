/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  AssistantRequestError,
  approximateTokensForChars,
  fetchAssistantContextSize,
  fetchAssistantModels,
  streamAssistantChat,
} from "./gmAssistantClient";

const sessionToken = "test-session-token";

vi.mock("config/supabase.config", () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: sessionToken } },
          error: null,
        }),
    },
  }),
}));

// Seam under test: the browser client for the GM assistant server
// function. It fetches the model list and streams chat replies as
// server-sent events, mapping every failure to a short generic error
// that carries the server's reference code (or a minted one when the
// network itself fails, so the key can never leak into the UI).
describe("gmAssistantClient", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://stack.example");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const lines = chunks.map(
      (content) => `data: ${JSON.stringify({ content })}\n\n`
    );
    return new Response(encoder.encode(lines.join("") + "data: [DONE]\n\n"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  it("lists the server's models for the campaign", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        models: [
          { id: "live-chat-model", context_tokens: 4096 },
          { id: "live-other-model", context_tokens: 8192 },
        ],
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const models = await fetchAssistantModels("campaign-1");

    expect(models).toEqual([
      { id: "live-chat-model", contextTokens: 4096 },
      { id: "live-other-model", contextTokens: 8192 },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://stack.example/functions/v1/gm-assistant/models?campaignId=campaign-1"
    );
    expect((init.headers as Headers).get("Authorization")).toBe(
      `Bearer ${sessionToken}`
    );
  });

  it("reports the not-set-up state with the server code", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(503, {
        code: "NOT_SET_UP",
        message: "The GM assistant is not set up on this server.",
        ref: "ABC123",
      })) as unknown as typeof fetch;

    const failure = await fetchAssistantModels("campaign-1").catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(AssistantRequestError);
    expect((failure as AssistantRequestError).code).toBe("NOT_SET_UP");
    expect((failure as AssistantRequestError).ref).toBe("ABC123");
  });

  it("streams a reply chunk by chunk", async () => {
    globalThis.fetch = (async () =>
      sseResponse(["Hello ", "traveller"])) as unknown as typeof fetch;
    const seen: string[] = [];

    const result = await streamAssistantChat({
      conversationId: "convo-1",
      message: "What happens next?",
      signal: new AbortController().signal,
      onChunk: (text) => seen.push(text),
    });

    expect(result).toEqual({ text: "Hello traveller", aborted: false });
    expect(seen).toEqual(["Hello ", "traveller"]);
  });

  it("carries the server reference on a chat failure", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(502, {
        code: "UPSTREAM_ERROR",
        message: "The assistant request failed.",
        ref: "ZZ9Q12",
      })) as unknown as typeof fetch;

    const failure = await streamAssistantChat({
      conversationId: "convo-1",
      message: "hi",
      signal: new AbortController().signal,
      onChunk: () => {},
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AssistantRequestError);
    expect((failure as AssistantRequestError).code).toBe("UPSTREAM_ERROR");
    expect((failure as AssistantRequestError).ref).toBe("ZZ9Q12");
  });

  it("marks an aborted stream as stopped with the partial text", async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise<never>((_resolve, reject) => {
        // Like a real fetch with a stalled upstream: hang until the
        // caller aborts, including when the signal fired first.
        const onAbort = (): void => {
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (init?.signal?.aborted) {
          onAbort();
          return;
        }
        init?.signal?.addEventListener("abort", onAbort);
      })) as unknown as typeof fetch;
    const caller = new AbortController();
    const seen: string[] = [];

    const pending = streamAssistantChat({
      conversationId: "convo-1",
      message: "Take your time",
      signal: caller.signal,
      onChunk: (text) => seen.push(text),
    });
    caller.abort();
    const result = await pending;

    expect(result.aborted).toBe(true);
    expect(seen).toEqual([]);
  });
});

// Seam under test: the context-size call. The panel asks the server how
// big the GM's saved context is (per-item sizes plus the instruction
// overhead and the skipped references), using the same character-to-token
// estimate the server sizes its chat text with.
describe("fetchAssistantContextSize", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://stack.example");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("converts characters to approximate tokens at four per token", () => {
    expect(approximateTokensForChars(0)).toBe(0);
    expect(approximateTokensForChars(1)).toBe(1);
    expect(approximateTokensForChars(4)).toBe(1);
    expect(approximateTokensForChars(5)).toBe(2);
  });

  it("returns the server sizes with the caller's token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [{ key: "lore:1", label: "Lore: Old Vault", chars: 400, tokens: 100 }],
        totalChars: 400,
        totalTokens: 100,
        instructionChars: 200,
        instructionTokens: 50,
        unavailable: [{ key: "lore:gone", reason: "not found" }],
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const size = await fetchAssistantContextSize("campaign-1");

    expect(size).toEqual({
      items: [{ key: "lore:1", label: "Lore: Old Vault", chars: 400, tokens: 100 }],
      totalChars: 400,
      totalTokens: 100,
      instructionChars: 200,
      instructionTokens: 50,
      unavailable: [{ key: "lore:gone", reason: "not found" }],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://stack.example/functions/v1/gm-assistant/context-size?campaignId=campaign-1"
    );
    expect((init.headers as Headers).get("Authorization")).toBe(
      `Bearer ${sessionToken}`
    );
  });

  it("carries the server reference on a size failure", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(403, {
        code: "FORBIDDEN",
        message: "Only the campaign's GMs can use the assistant.",
        ref: "QQ1Q22",
      })) as unknown as typeof fetch;

    const failure = await fetchAssistantContextSize("campaign-1").catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(AssistantRequestError);
    expect((failure as AssistantRequestError).code).toBe("FORBIDDEN");
    expect((failure as AssistantRequestError).ref).toBe("QQ1Q22");
  });
});
