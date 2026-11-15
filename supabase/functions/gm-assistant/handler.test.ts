/**
 * Unit tests for the GM assistant edge-function handler (ticket #129).
 *
 * Seam: the handler's HTTP boundary (Request in, Response out) with both
 * the PostgREST calls and the upstream model calls going through one
 * injected fetch. What this catches: routing, JWT checks, GM checks, the
 * allow-list, context sizes, the system prompt, streamed replies, stop
 * handling and the generic-error contract. What it misses (covered by the
 * live test): the Deno wiring, the gateway rewrite, real row-level security
 * and the real upstream.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createGmAssistantHandler,
  type GmAssistantEnv,
  type UpstreamFetch,
} from "./handler";

const GM_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const API_KEY = "sk-test-secret-KEY-abcdef123456";
const JWT_SECRET = "test-jwt-secret-that-is-long-enough";

function baseEnv(overrides: Partial<GmAssistantEnv> = {}): GmAssistantEnv {
  return {
    endpoint: "https://llm.test",
    apiKey: API_KEY,
    allowedModels: "",
    contextTokens: "",
    jwtSecret: JWT_SECRET,
    supabaseUrl: "http://api-gw:8000",
    anonKey: "anon-key",
    siteUrl: "https://site.test",
    gameSystem: "ironsworn",
    ...overrides,
  };
}

function b64url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function mintToken(claims: Record<string, unknown>): string {
  const header = b64url(
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64"),
  );
  const payload = b64url(Buffer.from(JSON.stringify(claims)).toString("base64"));
  const sig = b64url(
    createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64"),
  );
  return `${header}.${payload}.${sig}`;
}

function gmToken(): string {
  return mintToken({
    role: "authenticated",
    sub: GM_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}

interface RecordedCall {
  url: string;
  method: string;
  authorization: string | null;
  apikey: string | null;
  body: unknown;
  signalAborted: boolean;
}

interface FakeOptions {
  rosterRole?: string | null;
  conversation?: { id: string; campaignId: string } | null;
  history?: Array<{ role: string; content: string }>;
  savedModel?: string | null;
  models?: Array<Record<string, unknown>>;
  modelsStatus?: number;
  chatStatus?: number;
  chatChunks?: string[];
  stallChat?: boolean;
  failChatAfterChunks?: boolean;
  /** Artificial pause between streamed chunks, to let heartbeats fire. */
  chatDelayBetweenChunksMs?: number;
}

function makeFake(options: FakeOptions = {}): {
  fetchImpl: UpstreamFetch;
  calls: RecordedCall[];
  abortedUpstream: { current: boolean };
} {
  const calls: RecordedCall[] = [];
  const abortedUpstream = { current: false };
  const fetchImpl: UpstreamFetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init.headers);
    let body: unknown;
    try {
      body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    } catch {
      body = init.body;
    }
    const call: RecordedCall = {
      url,
      method: (init.method ?? "GET").toUpperCase(),
      authorization: headers.get("authorization"),
      apikey: headers.get("apikey"),
      body,
      signalAborted: false,
    };
    calls.push(call);
    const signal = init.signal as AbortSignal | undefined;
    if (signal) {
      if (signal.aborted) {
        call.signalAborted = true;
        abortedUpstream.current = true;
      } else {
        signal.addEventListener("abort", () => {
          call.signalAborted = true;
          abortedUpstream.current = true;
        });
      }
    }
    if (url.includes("/rest/v1/")) {
      if (url.includes("campaign_members")) {
        if (options.rosterRole) {
          return Response.json([{ role: options.rosterRole }]);
        }
        return Response.json([]);
      }
      if (url.includes("assistant_conversations")) {
        if (options.conversation === undefined) {
          return Response.json([{ id: CONVERSATION_ID, campaign_id: CAMPAIGN_ID }]);
        }
        return Response.json(options.conversation ? [options.conversation] : []);
      }
      if (url.includes("assistant_messages") && call.method === "GET") {
        // Emulate PostgREST: `history` is the stored table oldest first;
        // honour the single `order` and `limit` parameters the handler sends.
        const query = new URL(url).searchParams;
        const stored = [...(options.history ?? [])];
        if ((query.get("order") ?? "").startsWith("created_at.desc")) stored.reverse();
        const limit = Number(query.get("limit"));
        return Response.json(Number.isFinite(limit) && limit > 0 ? stored.slice(0, limit) : stored);
      }
      if (url.includes("assistant_messages") && call.method === "POST") {
        return Response.json([{ id: "new-message-id" }], { status: 201 });
      }
      if (url.includes("assistant_settings")) {
        if (options.savedModel) return Response.json([{ model: options.savedModel }]);
        return Response.json([]);
      }
      return Response.json([]);
    }
    if (url.endsWith("/models")) {
      const status = options.modelsStatus ?? 200;
      if (status !== 200) {
        return new Response(JSON.stringify({ error: { message: "upstream boom" } }), { status });
      }
      return Response.json({
        data:
          options.models ??
          ([
            { id: "test-chat-model", context_length: 4096 },
            { id: "other-model" },
            { id: "third-model", context_length: 16384 },
          ] as Array<Record<string, unknown>>),
      });
    }
    if (url.endsWith("/chat/completions")) {
      const status = options.chatStatus ?? 200;
      if (status !== 200) {
        return new Response(
          JSON.stringify({ error: { message: "upstream boom", type: "server_error" } }),
          { status },
        );
      }
      const chunks = options.chatChunks ?? ["Hello", " there"];
      if (options.stallChat) {
        // Never responds: the caller must abort.
        await new Promise<void>((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
        return new Response("never", { status: 200 });
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
              ),
            );
            if (options.failChatAfterChunks) {
              controller.error(new Error("upstream mid-stream boom"));
              return;
            }
            if (options.chatDelayBetweenChunksMs) {
              await new Promise((resolve) =>
                setTimeout(resolve, options.chatDelayBetweenChunksMs),
              );
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls, abortedUpstream };
}

function restCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => call.url.includes("/rest/v1/"));
}

async function readSseContents(res: Response): Promise<string[]> {
  const text = await res.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((payload) => payload !== "[DONE]")
    .map((payload) => (JSON.parse(payload) as { content: string }).content);
}

describe("gm assistant handler routing and auth", () => {
  it("answers unknown paths with the placeholder code", async () => {
    const { fetchImpl } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      new Request("http://x/smoke-probe", {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "FUNCTIONS_NOT_CONFIGURED" });
  });

  it("refuses anonymous callers on both endpoints", async () => {
    const { fetchImpl } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const models = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`),
    );
    expect(models.status).toBe(401);
    expect(await models.json()).toMatchObject({ code: "UNAUTHORIZED" });
    const chat = await handle(
      new Request("http://x/gm-assistant/chat", {
        method: "POST",
        body: JSON.stringify({ conversationId: CONVERSATION_ID, message: "hi" }),
      }),
    );
    expect(chat.status).toBe(401);
  });

  it("refuses forged, expired and non-authenticated tokens", async () => {
    const { fetchImpl } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const forged = mintToken({ role: "authenticated", sub: GM_ID, exp: Date.now() / 1000 + 3600 });
    void forged;
    const wrongSecret = (() => {
      const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64"));
      const payload = b64url(
        Buffer.from(
          JSON.stringify({ role: "authenticated", sub: GM_ID, exp: Date.now() / 1000 + 3600 }),
        ).toString("base64"),
      );
      const sig = b64url(
        createHmac("sha256", "wrong-secret").update(`${header}.${payload}`).digest("base64"),
      );
      return `${header}.${payload}.${sig}`;
    })();
    for (const token of [
      wrongSecret,
      mintToken({ role: "service_role", sub: GM_ID, exp: Date.now() / 1000 + 3600 }),
      mintToken({ role: "authenticated", sub: GM_ID, exp: Date.now() / 1000 - 10 }),
      mintToken({ role: "authenticated", sub: "not-a-uuid", exp: Date.now() / 1000 + 3600 }),
      "not.a.token",
    ]) {
      const res = await handle(
        new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      expect(res.status).toBe(401);
    }
  });

  it("answers preflight only for the site's own origin", async () => {
    const { fetchImpl } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const allowed = await handle(
      new Request("http://x/gm-assistant/chat", {
        method: "OPTIONS",
        headers: { Origin: "https://site.test" },
      }),
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://site.test");
    const denied = await handle(
      new Request("http://x/gm-assistant/chat", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.test" },
      }),
    );
    expect(denied.status).toBe(204);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("echoes CORS only for the site's own origin", async () => {
    const { fetchImpl } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const good = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}`, Origin: "https://site.test" },
      }),
    );
    expect(good.headers.get("Access-Control-Allow-Origin")).toBe("https://site.test");
    const bad = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}`, Origin: "https://evil.test" },
      }),
    );
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("gm assistant models endpoint", () => {
  it("reports not set up when no endpoint is configured", async () => {
    const { fetchImpl, calls } = makeFake({ rosterRole: "gm" });
    const handle = createGmAssistantHandler(baseEnv({ endpoint: "" }), fetchImpl);
    const res = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "NOT_SET_UP" });
    // The GM check runs first, but the endpoint is never contacted.
    expect(calls.some((call) => !call.url.includes("/rest/v1/"))).toBe(false);
  });

  it("refuses callers who are not GMs of the campaign", async () => {
    for (const rosterRole of ["player", null]) {
      const { fetchImpl } = makeFake({ rosterRole });
      const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
      const res = await handle(
        new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
          headers: { Authorization: `Bearer ${gmToken()}` },
        }),
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("rejects a missing campaign id", async () => {
    const { fetchImpl } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      new Request("http://x/gm-assistant/models", {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("filters by the allow-list and sizes each model", async () => {
    const { fetchImpl } = makeFake({ rosterRole: "gm" });
    const handle = createGmAssistantHandler(
      baseEnv({ allowedModels: " test-chat-model , third-model " }),
      fetchImpl,
    );
    const res = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      endpointHost: "llm.test",
      models: [
        { id: "test-chat-model", context_tokens: 4096 },
        { id: "third-model", context_tokens: 16384 },
      ],
    });
  });

  it("reports only the host of the endpoint, never userinfo, path, query or key", async () => {
    const { fetchImpl } = makeFake({ rosterRole: "gm" });
    const handle = createGmAssistantHandler(
      baseEnv({ endpoint: "https://user:hunter2@llm.test:8443/v1/?token=abc#frag" }),
      fetchImpl,
    );
    const res = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    const text = await res.text();
    expect(JSON.parse(text).endpointHost).toBe("llm.test:8443");
    for (const secret of ["user", "hunter2", "/v1", "token=", "abc", "frag", API_KEY]) {
      expect(text).not.toContain(secret);
    }
  });

  it("reports a null endpoint host when the endpoint cannot be parsed", async () => {
    const { fetchImpl } = makeFake({ rosterRole: "gm" });
    const handle = createGmAssistantHandler(baseEnv({ endpoint: "not a url" }), fetchImpl);
    const res = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    const body = (await res.json()) as { endpointHost?: unknown };
    expect(body.endpointHost ?? null).toBeNull();
    expect(JSON.stringify(body)).not.toContain("not a url");
  });

  it("falls back to the default context size without an upstream value", async () => {
    const { fetchImpl } = makeFake({ rosterRole: "gm" });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect(await res.json()).toEqual({
      endpointHost: "llm.test",
      models: [
        { id: "test-chat-model", context_tokens: 4096 },
        { id: "other-model", context_tokens: 8192 },
        { id: "third-model", context_tokens: 16384 },
      ],
    });
  });

  it("uses the configured context size as the fallback", async () => {
    const { fetchImpl } = makeFake({ rosterRole: "gm" });
    const handle = createGmAssistantHandler(baseEnv({ contextTokens: "32768" }), fetchImpl);
    const res = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    const body = (await res.json()) as {
      models: Array<{ id: string; context_tokens: number }>;
    };
    expect(body.models.find((model) => model.id === "other-model")).toEqual({
      id: "other-model",
      context_tokens: 32768,
    });
  });

  it("sends no upstream credentials when no key is configured", async () => {
    const { fetchImpl, calls } = makeFake({ rosterRole: "gm" });
    const handle = createGmAssistantHandler(baseEnv({ apiKey: "  " }), fetchImpl);
    const models = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect(models.status).toBe(200);
    const chat = await handle(
      new Request("http://x/gm-assistant/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${gmToken()}` },
        body: JSON.stringify({ conversationId: CONVERSATION_ID, message: "hi" }),
      }),
    );
    expect(chat.status).toBe(200);
    await chat.text();
    for (const call of calls) {
      if (!call.url.includes("/rest/v1/")) {
        expect(call.authorization).toBeNull();
      }
    }
  });

  it("turns an upstream failure into a generic error with a reference", async () => {    const { fetchImpl } = makeFake({ rosterRole: "gm", modelsStatus: 500 });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; message: string; ref: string };
    expect(body.code).toBe("UPSTREAM_ERROR");
    expect(body.ref).toMatch(/^[0-9A-Z]{6}$/);
    expect(JSON.stringify(body)).not.toContain(API_KEY);
  });
});

describe("gm assistant chat endpoint", () => {
  function chatRequest(body: unknown, signal?: AbortSignal): Request {
    return new Request("http://x/gm-assistant/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gmToken()}`,
        "Content-Type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
    });
  }

  it("rejects invalid bodies", async () => {
    const { fetchImpl } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    for (const body of [
      "not json",
      {},
      { conversationId: "nope", message: "hi" },
      { conversationId: CONVERSATION_ID, message: "   " },
    ]) {
      const res = await handle(chatRequest(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "INVALID_REQUEST" });
    }
  });

  it("reports not set up when no endpoint is configured", async () => {
    const { fetchImpl, calls } = makeFake();
    const handle = createGmAssistantHandler(baseEnv({ endpoint: "" }), fetchImpl);
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "NOT_SET_UP" });
    // The ownership check runs first, but the endpoint is never contacted.
    expect(calls.some((call) => !call.url.includes("/rest/v1/"))).toBe(false);
  });

  it("hides conversations the caller does not own", async () => {
    const { fetchImpl } = makeFake({ conversation: null });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });

  it("streams the reply and saves both messages with the caller JWT", async () => {
    const { fetchImpl, calls } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "What next?" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await readSseContents(res)).toEqual(["Hello", " there"]);

    const rest = restCalls(calls);
    expect(rest.length).toBeGreaterThan(0);
    for (const call of rest) {
      expect(call.authorization).toBe(`Bearer ${gmToken()}`);
      expect(call.apikey).toBe("anon-key");
    }
    const saves = rest.filter(
      (call) => call.url.includes("assistant_messages") && call.method === "POST",
    );
    expect(saves).toHaveLength(2);
    expect(saves[0].body).toMatchObject({
      conversation_id: CONVERSATION_ID,
      role: "user",
      content: "What next?",
      stopped_partway: false,
    });
    expect(saves[1].body).toMatchObject({
      conversation_id: CONVERSATION_ID,
      role: "assistant",
      content: "Hello there",
      stopped_partway: false,
    });

    const upstream = calls.find((call) => call.url.endsWith("/chat/completions"));
    expect(upstream?.authorization).toBe(`Bearer ${API_KEY}`);
    const outgoing = (upstream?.body as { messages: Array<{ role: string; content: string }> })
      .messages;
    expect(outgoing[0]).toMatchObject({ role: "system" });
    expect(outgoing[0].content).toContain("Ironsworn");
    expect(outgoing[0].content.toLowerCase()).toContain("draft");
    expect(outgoing.at(-1)).toMatchObject({ role: "user", content: "What next?" });
  });

  it("names the deployment's game system in the system prompt", async () => {
    const { fetchImpl, calls } = makeFake();
    const handle = createGmAssistantHandler(baseEnv({ gameSystem: "starforged" }), fetchImpl);
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const upstream = calls.find((call) => call.url.endsWith("/chat/completions"));
    const outgoing = (upstream?.body as { messages: Array<{ content: string }> }).messages;
    expect(outgoing[0].content).toContain("Starforged");
  });

  it("forwards the conversation history ahead of the new message", async () => {
    const { fetchImpl, calls } = makeFake({
      history: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
      ],
    });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "Then what?" }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const upstream = calls.find((call) => call.url.endsWith("/chat/completions"));
    const outgoing = (upstream?.body as { messages: Array<{ role: string; content: string }> })
      .messages;
    expect(outgoing.slice(1)).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Then what?" },
    ]);
  });

  it("sends the newest 100 stored messages, oldest first", async () => {
    const history = Array.from({ length: 130 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index + 1}`,
    }));
    const { fetchImpl, calls } = makeFake({ history });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "latest" }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const historyCall = calls.find(
      (call) => call.url.includes("assistant_messages") && call.method === "GET",
    );
    const query = new URL(historyCall?.url ?? "http://x").searchParams;
    expect(query.getAll("order")).toEqual(["created_at.desc,id.desc"]);
    expect(query.get("limit")).toBe("100");
    const upstream = calls.find((call) => call.url.endsWith("/chat/completions"));
    const outgoing = (upstream?.body as { messages: Array<{ content: string }> }).messages;
    const sent = outgoing.slice(1, -1).map((message) => message.content);
    expect(sent).toHaveLength(100);
    expect(sent[0]).toBe("message 31");
    expect(sent[99]).toBe("message 130");
    expect(outgoing[outgoing.length - 1].content).toBe("latest");
  });

  it("uses the GM's saved model when the endpoint still offers it", async () => {
    const { fetchImpl, calls } = makeFake({ savedModel: "third-model" });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const upstream = calls.find((call) => call.url.endsWith("/chat/completions"));
    expect((upstream?.body as { model: string }).model).toBe("third-model");
  });

  it("falls back to the first allowed model when the saved one is gone", async () => {
    const { fetchImpl, calls } = makeFake({ savedModel: "retired-model" });
    const handle = createGmAssistantHandler(
      baseEnv({ allowedModels: "third-model,other-model" }),
      fetchImpl,
    );
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const upstream = calls.find((call) => call.url.endsWith("/chat/completions"));
    // The allow-list filters the endpoint's order, so other-model (which the
    // endpoint lists first) wins over the retired saved choice.
    expect((upstream?.body as { model: string }).model).toBe("other-model");
  });

  it("cancels the upstream request when the browser aborts, keeping the partial", async () => {
    const { fetchImpl, calls, abortedUpstream } = makeFake({
      chatChunks: ["Part one ", "part two ", "part three"],
    });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const controller = new AbortController();
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "tell me" }, controller.signal),
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    controller.abort();
    await reader.read().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(abortedUpstream.current).toBe(true);
    const saves = restCalls(calls).filter(
      (call) => call.url.includes("assistant_messages") && call.method === "POST",
    );
    const partial = saves.find(
      (call) => (call.body as { role: string }).role === "assistant",
    );
    expect((partial?.body as { stopped_partway: boolean }).stopped_partway).toBe(true);
    expect(
      ((partial?.body as { content: string }).content ?? "").length,
    ).toBeGreaterThan(0);
  });

  it("sends SSE comment heartbeats while the upstream is slow", async () => {
    // A stalled upstream sends nothing, so a hung-up browser is only noticed
    // on the next write: the handler emits `: ping` comment heartbeats to
    // keep the stream alive (and to defeat proxy idle timeouts). Parsers
    // must skip them, so only real content reaches the reply.
    const { fetchImpl } = makeFake({
      chatChunks: ["Hello", " world"],
      chatDelayBetweenChunksMs: 120,
    });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl, {
      heartbeatMs: 30,
    });
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "slow please" }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(": ping");
    expect(text).toContain("data: [DONE]");
    expect(await readSseContents(new Response(text))).toEqual([
      "Hello",
      " world",
    ]);
  });

  it("turns an upstream chat failure into a generic error", async () => {
    const { fetchImpl } = makeFake({ chatStatus: 429 });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; ref: string };
    expect(body.code).toBe("UPSTREAM_ERROR");
    expect(body.ref).toMatch(/^[0-9A-Z]{6}$/);
    expect(JSON.stringify(body)).not.toContain(API_KEY);
    expect(res.headers.get("Authorization")).toBeNull();
  });

  it("never exposes the key in any response", async () => {
    const scenarios: Array<{ fake: FakeOptions; body: unknown; path: string }> = [
      { fake: { rosterRole: "gm", modelsStatus: 500 }, body: null, path: "models" },
      { fake: {}, body: { conversationId: CONVERSATION_ID, message: "hi" }, path: "chat-fail" },
    ];
    for (const scenario of scenarios) {
      const { fetchImpl } = makeFake(
        scenario.path === "chat-fail" ? { chatStatus: 500 } : scenario.fake,
      );
      const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
      const res =
        scenario.path === "models"
          ? await handle(
              new Request(`http://x/gm-assistant/models?campaignId=${CAMPAIGN_ID}`, {
                headers: { Authorization: `Bearer ${gmToken()}` },
              }),
            )
          : await handle(chatRequest(scenario.body));
      const text = scenario.path === "models" ? await res.text() : await res.text();
      expect(text).not.toContain(API_KEY);
      for (const [, value] of res.headers) {
        expect(value).not.toContain(API_KEY);
      }
    }
  });
});
