/**
 * Unit tests for the GM assistant outline-revision mode (ticket #133).
 *
 * Seam: the handler's HTTP boundary (Request in, Response out) with both
 * the PostgREST calls and the upstream model calls going through one
 * injected fetch. What this catches: the revision request carries the
 * current outline and asks for a complete replacement in an extractable
 * form, browser-supplied context never reaches the model, and the reply
 * is saved like any other. What it misses (covered by the live test):
 * the Deno wiring, real row-level security and the real upstream.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createGmAssistantHandler,
  extractOutlineProposal,
  OUTLINE_PROPOSAL_BEGIN,
  OUTLINE_PROPOSAL_END,
  type GmAssistantEnv,
  type UpstreamFetch,
} from "./handler";
import { mintRs256, testJwks } from "./testTokens";

const GM_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const OUTLINE_ID = "88888888-8888-4222-8222-888888888888";
const API_KEY = "sk-test-secret-KEY-abcdef123456";
const OUTLINE_TEXT = "Act one: the bell rings over the harbor.";

function baseEnv(overrides: Partial<GmAssistantEnv> = {}): GmAssistantEnv {
  return {
    endpoint: "https://llm.test",
    apiKey: API_KEY,
    allowedModels: "",
    contextTokens: "",
    jwtJwks: testJwks(),
    supabaseUrl: "http://api-gw:8000",
    anonKey: "anon-key",
    siteUrl: "https://site.test",
    gameSystem: "ironsworn",
    ...overrides,
  };
}

function gmToken(): string {
  return mintRs256({
    role: "authenticated",
    sub: GM_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}

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

function makeFake(): { fetchImpl: UpstreamFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: UpstreamFetch = async (input, init = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
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
      if (url.includes("assistant_messages") && (init.method ?? "GET") === "GET") {
        return Response.json([]);
      }
      if (url.includes("assistant_messages")) {
        return Response.json([{ id: "new-message-id" }], { status: 201 });
      }
      if (url.includes("assistant_settings")) return Response.json([]);
      if (url.includes("campaign_notes") && url.includes("kind=eq.outline")) {
        return Response.json([{ id: OUTLINE_ID, title: "Campaign outline" }]);
      }
      if (url.includes("campaign_note_contents")) {
        return Response.json([{ content: yjsB64(OUTLINE_TEXT) }]);
      }
      if (url.includes("campaigns")) return Response.json([]);
      return Response.json([]);
    }
    if (url.endsWith("/models")) {
      return Response.json({ data: [{ id: "test-chat-model", context_length: 4096 }] });
    }
    if (url.endsWith("/chat/completions")) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of [
            `${OUTLINE_PROPOSAL_BEGIN}\n`,
            "Act one revised: the bell cracks.\n",
            `${OUTLINE_PROPOSAL_END}`,
          ]) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`
              )
            );
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
  return { fetchImpl, calls };
}

function revisionRequest(body: unknown): Request {
  return new Request("http://x/gm-assistant/chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gmToken()}`,
      "Content-Type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("outline revision extraction", () => {
  it("pulls the proposed outline from between the markers", () => {
    expect(
      extractOutlineProposal(
        `Here is the new plan:\n${OUTLINE_PROPOSAL_BEGIN}\nAct one revised.\n${OUTLINE_PROPOSAL_END}\nGood luck.`
      )
    ).toBe("Act one revised.");
  });

  it("returns null when the reply carries no markers", () => {
    expect(extractOutlineProposal("Just some chat with no proposal.")).toBeNull();
    expect(extractOutlineProposal("")).toBeNull();
  });

  it("needs both markers to extract a proposal", () => {
    expect(extractOutlineProposal(`${OUTLINE_PROPOSAL_BEGIN}\nHalf a thought.`)).toBeNull();
  });
});

describe("gm assistant outline-revision mode", () => {
  it("includes the current outline and asks for a marked complete replacement", async () => {
    const { fetchImpl, calls } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      revisionRequest({
        conversationId: CONVERSATION_ID,
        message: "Add a betrayal in act two.",
        mode: "outline-revision",
      })
    );
    expect(res.status).toBe(200);
    await res.text();

    const upstream = calls.find((call) => call.url.endsWith("/chat/completions"));
    const outgoing = (upstream?.body as { messages: Array<{ role: string; content: string }> })
      .messages;
    const joined = outgoing.map((message) => message.content).join("\n");
    // The server includes the current outline even though the GM's saved
    // choice excludes it (the fake settings are empty).
    expect(joined).toContain(OUTLINE_TEXT);
    // ... and asks for a complete replacement in the extractable form.
    expect(joined).toContain(OUTLINE_PROPOSAL_BEGIN);
    expect(joined).toContain(OUTLINE_PROPOSAL_END);
    expect(joined.toLowerCase()).toContain("complete replacement");
    // The GM's instruction still travels as the user message.
    expect(outgoing.at(-1)).toMatchObject({
      role: "user",
      content: "Add a betrayal in act two.",
    });
  });

  it("saves the marked reply like any other assistant message", async () => {
    const { fetchImpl, calls } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      revisionRequest({
        conversationId: CONVERSATION_ID,
        message: "Tighten act one.",
        mode: "outline-revision",
      })
    );
    expect(res.status).toBe(200);
    await res.text();

    const saves = calls.filter(
      (call) => call.url.includes("assistant_messages") && call.method === "POST"
    );
    expect(saves).toHaveLength(2);
    const assistant = saves[1].body as { role: string; content: string };
    expect(assistant.role).toBe("assistant");
    expect(extractOutlineProposal(assistant.content)).toBe(
      "Act one revised: the bell cracks."
    );
  });

  it("ignores anything context-like the browser sends in revision mode", async () => {
    const { fetchImpl, calls } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      revisionRequest({
        conversationId: CONVERSATION_ID,
        message: "Revise it.",
        mode: "outline-revision",
        context: "BROWSER INJECTION",
        contextText: "BROWSER INJECTION",
      })
    );
    expect(res.status).toBe(200);
    await res.text();

    const upstream = calls.find((call) => call.url.endsWith("/chat/completions"));
    expect(JSON.stringify(upstream?.body)).not.toContain("BROWSER INJECTION");
  });

  it("rejects an unknown mode", async () => {
    const { fetchImpl } = makeFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      revisionRequest({
        conversationId: CONVERSATION_ID,
        message: "hi",
        mode: "write-it-for-me",
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("still hides conversations the caller does not own in revision mode", async () => {
    const { fetchImpl: fallback } = makeFake();
    const strangersFetch: UpstreamFetch = async (input, init = {}) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("assistant_conversations")) return Response.json([]);
      return fallback(input, init);
    };
    const handle = createGmAssistantHandler(baseEnv(), strangersFetch);
    const res = await handle(
      revisionRequest({
        conversationId: CONVERSATION_ID,
        message: "Revise it.",
        mode: "outline-revision",
      })
    );
    expect(res.status).toBe(404);
  });
});
