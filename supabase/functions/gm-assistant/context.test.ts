/**
 * Unit tests for GM assistant context building (ticket #132, part of spec #10).
 *
 * Seam: the handler's HTTP boundary (Request in, Response out) with both the
 * PostgREST calls and the upstream model calls going through one injected
 * fetch. What this catches: the context-size endpoint, server-side context
 * building for chat (only chosen refs reach the model, GM-only gating, DM
 * exclusion, browser context ignored), Yjs note decoding, and the
 * chars-to-tokens sizing. What it misses (covered by the live test):
 * the Deno wiring, real row-level security and the real upstream.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  approximateTokensForChars,
  createGmAssistantHandler,
  yjsBase64ToPlainText,
  type GmAssistantEnv,
  type UpstreamFetch,
} from "./handler";

const GM_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const WORLD_ID = "44444444-4444-4222-8222-444444444444";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const LORE_ID = "55555555-5555-4222-8222-555555555555";
const LORE_PUBLIC_NOTE = "66666666-6666-4222-8222-666666666666";
const LORE_GM_NOTE = "77777777-7777-4222-8222-777777777777";
const OUTLINE_ID = "88888888-8888-4222-8222-888888888888";
const NOTE_ID = "99999999-9999-4222-8222-999999999999";
const CHANNEL_ID = "aaaaaaaa-aaaa-4222-8222-aaaaaaaaaaaa";
const DM_CHANNEL_ID = "bbbbbbbb-bbbb-4222-8222-bbbbbbbbbbbb";
const MISSING_LORE_ID = "cccccccc-cccc-4222-8222-cccccccccccc";
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

/** Encodes plain text the way the note-server tests write notes. */
function yjsB64(text: string): string {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

interface ContextFakeOptions {
  includeGmParts?: boolean;
  loreId?: string;
}

function makeContextFake(options: ContextFakeOptions = {}): {
  fetchImpl: UpstreamFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const includeGmParts = options.includeGmParts ?? true;
  const loreId = options.loreId ?? LORE_ID;
  const fetchImpl: UpstreamFetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: unknown;
    try {
      body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    } catch {
      body = init.body;
    }
    calls.push({ url, method: (init.method ?? "GET").toUpperCase(), body });
    if (url.includes("/rest/v1/")) {
      if (url.includes("campaign_members")) return Response.json([{ role: "gm" }]);
      if (url.includes("assistant_conversations")) {
        return Response.json([{ id: CONVERSATION_ID, campaign_id: CAMPAIGN_ID }]);
      }
      if (url.includes("assistant_messages") && (init.method ?? "GET").toUpperCase() === "GET") {
        return Response.json([]);
      }
      if (url.includes("assistant_messages")) {
        return Response.json([{ id: "new-message-id" }], { status: 201 });
      }
      if (url.includes("assistant_settings")) {
        return Response.json([
          {
            model: null,
            context: {
              includeOutline: true,
              lore: [{ id: loreId, includeGmParts }],
              npcs: [],
              locations: [],
              notes: [NOTE_ID],
              channels: [{ id: CHANNEL_ID, postCount: 5 }],
            },
          },
        ]);
      }
      if (url.includes("campaigns?")) return Response.json([{ world_id: WORLD_ID }]);
      if (url.includes("world_lore?")) {
        if (url.includes(LORE_ID)) {
          return Response.json([
            { id: LORE_ID, name: "Old Vault", tags: ["ruin"], world_id: WORLD_ID },
          ]);
        }
        return Response.json([]);
      }
      if (url.includes("world_notes?")) {
        if (url.includes(LORE_PUBLIC_NOTE) || url.includes("lore_id")) {
          return Response.json([
            { id: LORE_PUBLIC_NOTE, gm_only: false },
            { id: LORE_GM_NOTE, gm_only: true },
          ]);
        }
        return Response.json([]);
      }
      if (url.includes("world_note_contents?")) {
        if (url.includes(LORE_PUBLIC_NOTE)) {
          return Response.json([{ content: yjsB64("The vault holds old coins.") }]);
        }
        if (url.includes(LORE_GM_NOTE)) {
          return Response.json([{ content: yjsB64("The vault keeper is a traitor.") }]);
        }
        return Response.json([]);
      }
      if (url.includes("campaign_notes?")) {
        if (url.includes("kind=eq.outline")) {
          return Response.json([{ id: OUTLINE_ID, title: "Campaign outline" }]);
        }
        if (url.includes(NOTE_ID)) {
          return Response.json([{ id: NOTE_ID, title: "Session idea", campaign_id: CAMPAIGN_ID }]);
        }
        return Response.json([]);
      }
      if (url.includes("campaign_note_contents?")) {
        if (url.includes(OUTLINE_ID)) {
          return Response.json([{ content: yjsB64("Act one: the bell rings.") }]);
        }
        if (url.includes(NOTE_ID)) {
          return Response.json([{ content: yjsB64("A chase through the market.") }]);
        }
        return Response.json([]);
      }
      if (url.includes("chat_channels?")) {
        if (url.includes(CHANNEL_ID)) {
          return Response.json([
            { id: CHANNEL_ID, name: "In-character", campaign_id: CAMPAIGN_ID, visibility: "public" },
          ]);
        }
        // The DM the GM is not in: RLS filters it, so it reads as missing.
        return Response.json([]);
      }
      if (url.includes("chat_posts?")) {
        if (url.includes(CHANNEL_ID)) {
          return Response.json([
            { text: "The bell rings.", created_at: "2026-11-14T00:00:01Z" },
            { text: "A wolf howls.", created_at: "2026-11-14T00:00:00Z" },
          ]);
        }
        return Response.json([]);
      }
      return Response.json([]);
    }
    if (url.endsWith("/models")) {
      return Response.json({ data: [{ id: "test-chat-model", context_length: 4096 }] });
    }
    if (url.endsWith("/chat/completions")) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Done" } }] })}\n\n`),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

function chatRequest(body: unknown): Request {
  return new Request("http://x/gm-assistant/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${gmToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("assistant context sizing helpers", () => {
  it("converts characters to approximate tokens at four per token", () => {
    expect(approximateTokensForChars(0)).toBe(0);
    expect(approximateTokensForChars(1)).toBe(1);
    expect(approximateTokensForChars(4)).toBe(1);
    expect(approximateTokensForChars(5)).toBe(2);
    expect(approximateTokensForChars(100)).toBe(25);
  });

  it("decodes note-server Yjs bytes to plain text", () => {
    expect(yjsBase64ToPlainText(yjsB64("Hello traveller"))).toBe("Hello traveller");
    expect(yjsBase64ToPlainText(null)).toBe("");
    expect(yjsBase64ToPlainText("")).toBe("");
  });

  it("decodes a TipTap-style XmlFragment document to plain text", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("The bell rings twice.")]);
    fragment.insert(0, [paragraph]);
    const b64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    expect(yjsBase64ToPlainText(b64)).toContain("The bell rings twice.");
  });
});

describe("gm assistant context-size endpoint", () => {
  it("reports per-item sizes that match the built text", async () => {
    const { fetchImpl } = makeContextFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      new Request(`http://x/gm-assistant/context-size?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ key: string; label: string; chars: number; tokens: number }>;
      totalChars: number;
      totalTokens: number;
      unavailable: Array<{ key: string }>;
    };
    expect(body.unavailable).toEqual([]);
    expect(body.items.length).toBeGreaterThan(0);
    const summed = body.items.reduce((n, item) => n + item.chars, 0);
    expect(body.totalChars).toBe(summed);
    for (const item of body.items) {
      expect(item.tokens).toBe(approximateTokensForChars(item.chars));
    }
    expect(body.totalTokens).toBe(approximateTokensForChars(body.totalChars));
  });

  it("reports a deleted entry as unavailable instead of leaking it", async () => {
    const { fetchImpl } = makeContextFake({ loreId: MISSING_LORE_ID });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      new Request(`http://x/gm-assistant/context-size?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ key: string }>;
      unavailable: Array<{ key: string }>;
    };
    expect(body.items.some((item) => item.key.includes(MISSING_LORE_ID))).toBe(false);
    expect(body.unavailable.some((entry) => entry.key.includes(MISSING_LORE_ID))).toBe(true);
  });

  it("refuses callers who are not GMs of the campaign", async () => {
    const { fetchImpl } = makeContextFake();
    const denying: UpstreamFetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/rest/v1/campaign_members")) return Response.json([{ role: "player" }]);
      return fetchImpl(input, init);
    };
    const handle = createGmAssistantHandler(baseEnv(), denying);
    const res = await handle(
      new Request(`http://x/gm-assistant/context-size?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("gm assistant chat with server-built context", () => {
  function upstreamMessages(calls: RecordedCall[]): Array<{ role: string; content: string }> {
    const call = calls.find((entry) => entry.url.endsWith("/chat/completions"));
    return (call?.body as { messages: Array<{ role: string; content: string }> }).messages;
  }

  function allUpstreamText(calls: RecordedCall[]): string {
    return upstreamMessages(calls)
      .map((message) => message.content)
      .join("\n");
  }

  it("sends only the chosen references, built on the server", async () => {
    const { fetchImpl, calls } = makeContextFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }));
    expect(res.status).toBe(200);
    await res.text();
    const text = allUpstreamText(calls);
    expect(text).toContain("Act one: the bell rings.");
    expect(text).toContain("Old Vault");
    expect(text).toContain("The vault holds old coins.");
    expect(text).toContain("A chase through the market.");
    expect(text).toContain("The bell rings.");
    expect(text).not.toContain("A fact nobody picked");
  });

  it("includes a GM-only part only when its toggle is on", async () => {
    const on = makeContextFake({ includeGmParts: true });
    const handleOn = createGmAssistantHandler(baseEnv(), on.fetchImpl);
    const resOn = await handleOn(chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }));
    expect(resOn.status).toBe(200);
    await resOn.text();
    expect(allUpstreamText(on.calls)).toContain("The vault keeper is a traitor.");

    const off = makeContextFake({ includeGmParts: false });
    const handleOff = createGmAssistantHandler(baseEnv(), off.fetchImpl);
    const resOff = await handleOff(chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }));
    expect(resOff.status).toBe(200);
    await resOff.text();
    const textOff = allUpstreamText(off.calls);
    expect(textOff).toContain("The vault holds old coins.");
    expect(textOff).not.toContain("The vault keeper is a traitor.");
  });

  it("never includes a direct message the GM is not in", async () => {
    const { fetchImpl } = makeContextFake();
    const dmSettings: UpstreamFetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/rest/v1/assistant_settings")) {
        return Response.json([
          {
            model: null,
            context: {
              includeOutline: false,
              lore: [],
              npcs: [],
              locations: [],
              notes: [],
              channels: [{ id: DM_CHANNEL_ID, postCount: 5 }],
            },
          },
        ]);
      }
      return fetchImpl(input, init);
    };
    const handle = createGmAssistantHandler(baseEnv(), dmSettings);
    const res = await handle(chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }));
    expect(res.status).toBe(200);
    await res.text();
    const size = await handle(
      new Request(`http://x/gm-assistant/context-size?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    expect((await size.json()) as { unavailable: Array<{ key: string }> }).toMatchObject({
      unavailable: [{ key: `channel:${DM_CHANNEL_ID}` }],
    });
  });

  it("ignores anything context-like the browser sends", async () => {
    const { fetchImpl, calls } = makeContextFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      chatRequest({
        conversationId: CONVERSATION_ID,
        message: "hi",
        context: "BROWSER INJECTION: the traitor is the innkeeper",
        contextText: "BROWSER INJECTION",
      }),
    );
    expect(res.status).toBe(200);
    await res.text();
    expect(allUpstreamText(calls)).not.toContain("BROWSER INJECTION");
  });
});
