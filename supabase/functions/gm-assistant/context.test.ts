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
import { describe, expect, it, vi } from "vitest";
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
const PLAYER_ID = "dddddddd-dddd-4222-8222-dddddddddddd";
const PLAYER_CHARACTER_ID = "eeeeeeee-eeee-4222-8222-eeeeeeeeeeee";
const OTHER_PLAYER_ID = "12121212-1212-4212-8212-121212121212";
const OTHER_CAMPAIGN_ID = "ffffffff-ffff-4222-8222-ffffffffffff";
const MISSING_LORE_ID = "cccccccc-cccc-4222-8222-cccccccccccc";
const NPC_ID = "13131313-1313-4313-8313-131313131313";
const LOCATION_ID = "14141414-1414-4414-8414-141414141414";
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
  /** The campaign the fake's note row really belongs to. */
  noteCampaignId?: string;
  /** The world the fake's campaign belongs to; null means no world. */
  campaignWorldId?: string | null;
  /** The world the fake's lore row really belongs to. */
  loreWorldId?: string;
  /** The world the fake's NPC row really belongs to. */
  npcWorldId?: string;
  /** The world the fake's location row really belongs to. */
  locationWorldId?: string;
}

function makeContextFake(options: ContextFakeOptions = {}): {
  fetchImpl: UpstreamFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const includeGmParts = options.includeGmParts ?? true;
  const loreId = options.loreId ?? LORE_ID;
  const noteCampaignId = options.noteCampaignId ?? CAMPAIGN_ID;
  const campaignWorldId = options.campaignWorldId === undefined ? WORLD_ID : options.campaignWorldId;
  const loreWorldId = options.loreWorldId ?? WORLD_ID;
  const npcWorldId = options.npcWorldId ?? WORLD_ID;
  const locationWorldId = options.locationWorldId ?? WORLD_ID;
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
      if (url.includes("campaign_members")) {
        return Response.json([
          { role: "gm", user_id: GM_ID },
          { role: "player", user_id: PLAYER_ID },
          { role: "player", user_id: OTHER_PLAYER_ID },
        ]);
      }
      if (url.includes("characters?")) {
        return Response.json([{ id: PLAYER_CHARACTER_ID, name: "Kira Vance" }]);
      }
      if (url.includes("profiles?")) {
        return Response.json([
          { id: GM_ID, display_name: "Mara" },
          { id: PLAYER_ID, display_name: "Jo" },
        ]);
      }
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
      if (url.includes("campaigns?")) return Response.json([{ world_id: campaignWorldId }]);
      if (url.includes("world_lore?")) {
        if (url.includes(LORE_ID)) {
          return Response.json([
            { id: LORE_ID, name: "Old Vault", tags: ["ruin"], world_id: loreWorldId },
          ]);
        }
        return Response.json([]);
      }
      if (url.includes("world_npcs?")) {
        if (url.includes(NPC_ID)) {
          // Like PostgREST: a world filter that does not match reads
          // nothing, so an NPC from another world is never named.
          if (url.includes("world_id=eq.") && !url.includes(`world_id=eq.${npcWorldId}`)) {
            return Response.json([]);
          }
          return Response.json([
            { id: NPC_ID, name: "Old Bonegnaw", world_id: npcWorldId },
          ]);
        }
        return Response.json([]);
      }
      if (url.includes("world_locations?")) {
        if (url.includes(LOCATION_ID)) {
          return Response.json([
            { id: LOCATION_ID, name: "Old Watchtower", world_id: locationWorldId },
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
          // Like PostgREST: a campaign filter that does not match reads nothing.
          if (url.includes("campaign_id=eq.") && !url.includes(`campaign_id=eq.${noteCampaignId}`)) {
            return Response.json([]);
          }
          return Response.json([{ id: NOTE_ID, title: "Session idea", campaign_id: noteCampaignId }]);
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
            {
              text: "The bell rings.",
              created_at: "2026-11-14T00:00:01Z",
              author_id: PLAYER_ID,
              speaker_character_id: PLAYER_CHARACTER_ID,
              speaker_npc_id: null,
            },
            {
              text: "A wolf howls.",
              created_at: "2026-11-14T00:00:00Z",
              author_id: GM_ID,
              speaker_character_id: null,
              speaker_npc_id: null,
            },
            {
              text: "Out of character: brb.",
              created_at: "2026-11-13T23:59:00Z",
              author_id: OTHER_PLAYER_ID,
              speaker_character_id: null,
              speaker_npc_id: null,
            },
            {
              text: "The GM narrates as Kira.",
              created_at: "2026-11-13T23:58:00Z",
              author_id: GM_ID,
              speaker_character_id: PLAYER_CHARACTER_ID,
              speaker_npc_id: null,
            },
            {
              text: "The wolf speaks.",
              created_at: "2026-11-13T23:57:00Z",
              author_id: OTHER_PLAYER_ID,
              speaker_character_id: null,
              speaker_npc_id: NPC_ID,
            },
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

  it("refuses callers who are not GMs of the campaign, before any data is read", async () => {
    const { fetchImpl, calls } = makeContextFake();
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
    // Only the role check ran: the gate comes before every data read.
    const reads = calls.filter((call) => call.url.includes("/rest/v1/"));
    expect(reads.every((call) => call.url.includes("campaign_members"))).toBe(true);
  });
});

describe("gm assistant context-size preview", () => {
  it("sizes a posted preview list in one request, not the saved context", async () => {
    const { fetchImpl, calls } = makeContextFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(
      new Request("http://x/gm-assistant/context-size", {
        method: "POST",
        headers: { Authorization: `Bearer ${gmToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: CAMPAIGN_ID,
          context: {
            includeOutline: false,
            lore: [],
            npcs: [],
            locations: [],
            notes: [NOTE_ID],
            channels: [{ id: CHANNEL_ID, postCount: 5 }],
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ key: string; tokens: number }> };
    expect(body.items.map((item) => item.key).sort()).toEqual(
      [`channel:${CHANNEL_ID}`, `note:${NOTE_ID}`].sort(),
    );
    expect(calls.some((call) => call.url.includes("assistant_settings"))).toBe(false);
  });

  it("refuses a preview from someone who is not a GM and a malformed body", async () => {
    const { fetchImpl } = makeContextFake();
    const denying: UpstreamFetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/rest/v1/campaign_members")) return Response.json([{ role: "player" }]);
      return fetchImpl(input, init);
    };
    const post = (handle: (req: Request) => Promise<Response>, body: string) =>
      handle(
        new Request("http://x/gm-assistant/context-size", {
          method: "POST",
          headers: { Authorization: `Bearer ${gmToken()}`, "Content-Type": "application/json" },
          body,
        }),
      );
    const denied = await post(
      createGmAssistantHandler(baseEnv(), denying),
      JSON.stringify({ campaignId: CAMPAIGN_ID, context: {} }),
    );
    expect(denied.status).toBe(403);
    const bad = await post(createGmAssistantHandler(baseEnv(), fetchImpl), "not json");
    expect(bad.status).toBe(400);
    const huge = await post(
      createGmAssistantHandler(baseEnv(), fetchImpl),
      JSON.stringify({ campaignId: CAMPAIGN_ID, context: { notes: [], pad: "x".repeat(70 * 1024) } }),
    );
    expect(huge.status).toBe(413);
    const hugeBody = (await huge.json()) as { message: string; ref: string };
    expect(hugeBody.ref).toMatch(/^[A-Z0-9]{6}$/);
    expect(hugeBody.message).not.toContain("xxx");
  });
});

describe("world references follow the campaign's own world", () => {
  const worldTables = ["world_lore?", "world_npcs?", "world_locations?"];
  const OTHER_WORLD_ID = "abababab-abab-4bab-8bab-abababababab";

  function sizeRequest(): Request {
    return new Request(`http://x/gm-assistant/context-size?campaignId=${CAMPAIGN_ID}`, {
      headers: { Authorization: `Bearer ${gmToken()}` },
    });
  }

  function previewRequest(): Request {
    return new Request("http://x/gm-assistant/context-size", {
      method: "POST",
      headers: { Authorization: `Bearer ${gmToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: CAMPAIGN_ID,
        context: {
          includeOutline: false,
          lore: [{ id: LORE_ID, includeGmParts: true }],
          npcs: [{ id: NPC_ID, includeGmParts: true }],
          locations: [{ id: LOCATION_ID, includeGmParts: true }],
          notes: [],
          channels: [],
        },
      }),
    });
  }

  function upstreamText(calls: RecordedCall[]): string {
    return calls
      .filter((call) => call.url.endsWith("/chat/completions"))
      .map((call) => JSON.stringify(call.body))
      .join("\n");
  }

  type SizeBody = { items: Array<{ key: string }>; unavailable: Array<{ key: string }> };

  it("ignores world references, with no world query, when the campaign has no world", async () => {
    const { fetchImpl, calls } = makeContextFake({ campaignWorldId: null });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);

    const chat = await handle(chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }));
    expect(chat.status).toBe(200);
    await chat.text();
    expect(upstreamText(calls)).not.toContain("The vault holds old coins.");

    for (const request of [sizeRequest(), previewRequest()]) {
      const res = await handle(request);
      expect(res.status).toBe(200);
      const body = (await res.json()) as SizeBody;
      expect(body.items.some((item) => item.key.startsWith("lore:"))).toBe(false);
      expect(body.unavailable.map((entry) => entry.key)).toContain(`lore:${LORE_ID}`);
    }
    const preview = (await (await handle(previewRequest())).json()) as SizeBody;
    expect(preview.unavailable.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([`npc:${NPC_ID}`, `location:${LOCATION_ID}`]),
    );

    expect(calls.some((call) => worldTables.some((table) => call.url.includes(table)))).toBe(false);
    expect(calls.some((call) => call.url.includes("world_notes?"))).toBe(false);
  });

  it("ignores a reference from another world when the campaign has a world", async () => {
    const { fetchImpl, calls } = makeContextFake({
      loreWorldId: OTHER_WORLD_ID,
      npcWorldId: OTHER_WORLD_ID,
      locationWorldId: OTHER_WORLD_ID,
    });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);

    const chat = await handle(chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }));
    expect(chat.status).toBe(200);
    await chat.text();
    expect(upstreamText(calls)).not.toContain("The vault holds old coins.");

    for (const request of [sizeRequest(), previewRequest()]) {
      const res = await handle(request);
      const body = (await res.json()) as SizeBody;
      expect(body.items.some((item) => item.key.startsWith("lore:"))).toBe(false);
      expect(body.unavailable.map((entry) => entry.key)).toContain(`lore:${LORE_ID}`);
    }
    // The same world check covers NPCs and locations, not just lore.
    const preview = (await (await handle(previewRequest())).json()) as SizeBody;
    expect(preview.unavailable.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([`npc:${NPC_ID}`, `location:${LOCATION_ID}`]),
    );

    const worldReads = calls.filter((call) =>
      worldTables.some((table) => call.url.includes(table))
    );
    expect(worldReads.length).toBeGreaterThan(0);
    for (const call of worldReads) {
      expect(call.url).toContain(`world_id=eq.${WORLD_ID}`);
    }
  });

  it("names an NPC speaker only within the campaign's own world", async () => {
    const { fetchImpl, calls } = makeContextFake({ npcWorldId: OTHER_WORLD_ID });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }));
    expect(res.status).toBe(200);
    await res.text();

    const text = upstreamText(calls);
    // The NPC's name never reaches the model; the speaker falls back to the
    // neutral label.
    expect(text).not.toContain("Old Bonegnaw");
    expect(text).toContain("Player 2: The wolf speaks.");
    // The NPC-name read is filtered to the campaign's own world.
    const npcReads = calls.filter((call) => call.url.includes("world_npcs?"));
    expect(npcReads.length).toBeGreaterThan(0);
    for (const call of npcReads) {
      expect(call.url).toContain(`world_id=eq.${WORLD_ID}`);
    }
  });
});

describe("a failed campaign-world read", () => {
  it("logs one line with a reference and no ids, and still builds the rest", async () => {
    const base = makeContextFake();
    const failing: UpstreamFetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/rest/v1/campaigns?")) {
        return new Response("boom", { status: 500 });
      }
      return base.fetchImpl(input, init);
    };
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "));
    });
    try {
      const handle = createGmAssistantHandler(baseEnv(), failing);
      const res = await handle(chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }));
      expect(res.status).toBe(200);
      await res.text();

      const worldLine = lines.find((line) => line.includes("code=WORLD_READ_FAILED"));
      expect(worldLine).toBeDefined();
      expect(worldLine).toContain("status=500");
      expect(worldLine).toMatch(/ref=[0-9A-Z]{6}/);
      // The line names the failed read, never a row id.
      expect(worldLine).not.toContain(CAMPAIGN_ID);
      expect(worldLine).not.toContain(GM_ID);
      expect(worldLine).not.toContain(PLAYER_ID);
      // The failure is not fatal: world references are skipped, and the
      // rest of the context still reaches the model.
      const text = base.calls
        .filter((call) => call.url.endsWith("/chat/completions"))
        .map((call) => JSON.stringify(call.body))
        .join("\n");
      expect(text).toContain("The bell rings.");
      expect(text).not.toContain("The vault holds old coins.");
    } finally {
      spy.mockRestore();
    }
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

  it("names the speaker of every recent post without sending account display names", async () => {
    const { fetchImpl, calls } = makeContextFake();
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }));
    expect(res.status).toBe(200);
    await res.text();
    const text = allUpstreamText(calls);
    expect(text).toContain("Kira Vance: The bell rings.");
    expect(text).toContain("GM: A wolf howls.");
    // A player with no character gets a stable neutral label, not their name.
    expect(text).toContain("Player 2: Out of character: brb.");
    // A named GM speaker keeps the GM suffix.
    expect(text).toContain("Kira Vance (GM): The GM narrates as Kira.");
    // Account display names never reach the model endpoint.
    expect(text).not.toContain("Mara");
    expect(text).not.toContain("Jo");
    expect(calls.some((call) => call.url.includes("profiles"))).toBe(false);
    // Oldest first, as before.
    expect(text.indexOf("A wolf howls.")).toBeLessThan(text.indexOf("The bell rings."));
  });

  it("ignores a note reference from another campaign", async () => {
    const { fetchImpl, calls } = makeContextFake({ noteCampaignId: OTHER_CAMPAIGN_ID });
    const handle = createGmAssistantHandler(baseEnv(), fetchImpl);
    const res = await handle(chatRequest({ conversationId: CONVERSATION_ID, message: "hi" }));
    expect(res.status).toBe(200);
    await res.text();
    expect(allUpstreamText(calls)).not.toContain("A chase through the market.");
    expect(
      calls.some(
        (call) =>
          call.url.includes("campaign_notes?") &&
          call.url.includes(NOTE_ID) &&
          call.url.includes(`campaign_id=eq.${CAMPAIGN_ID}`),
      ),
    ).toBe(true);
    const size = await handle(
      new Request(`http://x/gm-assistant/context-size?campaignId=${CAMPAIGN_ID}`, {
        headers: { Authorization: `Bearer ${gmToken()}` },
      }),
    );
    const body = (await size.json()) as { unavailable: Array<{ key: string }> };
    expect(body.unavailable.map((entry) => entry.key)).toContain(`note:${NOTE_ID}`);
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
