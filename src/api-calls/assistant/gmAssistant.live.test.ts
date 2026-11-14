/**
 * Live tests for the GM assistant server function (ticket #129).
 *
 * Seam: the deployed Edge Runtime function through the gateway against a
 * real stack copy, with a fake OpenAI-compatible server standing in for the
 * model. What this catches: the Deno wiring, the gateway rewrite, real
 * row-level security, CORS, abort propagation and the configured-vs-blank
 * endpoint. The fake server runs on the host; the functions container
 * reaches it over `host.docker.internal` and is recreated with the test
 * endpoint exactly once, then restored to its pristine config.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GmAssistantEnv } from "../../../supabase/functions/gm-assistant/handler";

// Pulls the edge-function handler into the repo type-check (it ships outside
// src, so nothing else covers it); erased at runtime.
const handlerEnvType: GmAssistantEnv | null = null;
void handlerEnvType;

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { ASSISTANT_MESSAGES_TABLE } from "api-calls/assistant/_getRef";
import { createConversation } from "api-calls/assistant/createConversation";
import {
  FAKE_CHAT_MODEL,
  FAKE_OTHER_MODEL,
  startFakeAssistantUpstream,
  type FakeAssistantUpstream,
} from "api-calls/testing/fakeAssistantUpstream";
import {
  callFunction,
  detectComposeProject,
  readEnvFile,
  recreateFunctionsContainer,
  sseContents,
  waitForFunctionsReady,
  type ComposeTarget,
  type FunctionCallResult,
} from "api-calls/testing/liveFunctions";
import {
  createPerson,
  deletePerson,
  liveStackConfig,
  personToken,
  waitFor,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";

const config = liveStackConfig();
const FAKE_PORT = Number(process.env.LIVE_FAKE_LLM_PORT ?? 4010);
// Distinctive on purpose: every response the function sends is scanned for
// this value to prove the key never leaks.
const TEST_API_KEY = "sk-live-test-gm-assistant-key-001";
const ALLOW_LIST = `${FAKE_CHAT_MODEL},${FAKE_OTHER_MODEL}`;

async function signInAs(person: LivePerson): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email: person.email,
    password: person.password,
  });
  if (error) throw error;
}

async function signOut(): Promise<void> {
  await getSupabaseClient().auth.signOut();
}

describe.skipIf(!config)("gm assistant server function", () => {
  const cfg = config as LiveStackConfig;
  let functionsBase = "";
  let people: LivePerson[] = [];
  let fake: FakeAssistantUpstream | null = null;
  let target: ComposeTarget | null = null;
  let siteUrl = "";
  let gameSystem = "";
  let configured = false;
  const seen: FunctionCallResult[] = [];

  async function call(path: string, options: Parameters<typeof callFunction>[2] = {}) {
    const result = await callFunction(functionsBase, path, {
      ...options,
      origin: options.origin ?? siteUrl,
    });
    seen.push(result);
    return result;
  }

  async function ensureConfigured(): Promise<void> {
    if (configured || !fake || !target) return;
    recreateFunctionsContainer(target, {
      GM_ASSISTANT_ENDPOINT: fake.containerUrl,
      GM_ASSISTANT_API_KEY: TEST_API_KEY,
      GM_ASSISTANT_ALLOWED_MODELS: ALLOW_LIST,
    });
    await waitForFunctionsReady(functionsBase);
    configured = true;
  }

  beforeAll(async () => {
    functionsBase = `${cfg.url.replace(/\/+$/, "")}/functions/v1`;
    const envFile =
      process.env.LIVE_ENV_FILE ??
      (() => {
        throw new Error("LIVE_ENV_FILE is not set (run through supabase/tests/live.sh)");
      })();
    const vars = readEnvFile(envFile);
    if ((vars.GM_ASSISTANT_ENDPOINT ?? "").trim() !== "") {
      throw new Error(
        "live: GM_ASSISTANT_ENDPOINT must be blank in the copy env file so the not-set-up test runs against a pristine stack",
      );
    }
    siteUrl = process.env.LIVE_SITE_URL || vars.SITE_URL || "";
    gameSystem = process.env.LIVE_GAME_SYSTEM || vars.GAME_SYSTEM || "ironsworn";
    target = detectComposeProject(envFile);
    fake = await startFakeAssistantUpstream(FAKE_PORT);
  }, 60000);

  afterAll(async () => {
    try {
      if (target && configured) {
        recreateFunctionsContainer(target, {});
        await waitForFunctionsReady(functionsBase);
      }
    } finally {
      await fake?.close().catch(() => undefined);
      fake = null;
      await signOut().catch(() => {});
      await Promise.all(
        people.map((person) => deletePerson(cfg, person.userId).catch(() => {})),
      );
      people = [];
    }
  }, 180000);

  async function setUpCampaign(): Promise<{
    gm: LivePerson;
    player: LivePerson;
    outsider: LivePerson;
    campaignId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, player, outsider);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Assisted quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    return { gm, player, outsider, campaignId };
  }

  async function readMessagesAs(person: LivePerson, conversationId: string) {
    const { data, error } = await person.client
      .from(ASSISTANT_MESSAGES_TABLE)
      .select("role,content,stopped_partway")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    expect(error).toBeNull();
    return (data ?? []) as Array<{ role: string; content: string; stopped_partway: boolean }>;
  }

  it("reports not set up with no endpoint", { timeout: 60000 }, async () => {
    const { gm, campaignId } = await setUpCampaign();
    const token = await personToken(gm);
    const models = await call(`/gm-assistant/models?campaignId=${campaignId}`, { token });
    expect(models.status).toBe(503);
    expect(JSON.parse(models.text)).toMatchObject({ code: "NOT_SET_UP" });
  });

  it("streams a reply and saves both messages", { timeout: 180000 }, async () => {
    await ensureConfigured();
    const { gm, campaignId } = await setUpCampaign();
    await signInAs(gm);
    const conversationId = await createConversation({ campaignId, title: "Story planning" });
    await signOut();
    const token = await personToken(gm);

    const chat = await call("/gm-assistant/chat", {
      token,
      body: { conversationId, message: "What happens next?" },
    });
    expect(chat.status).toBe(200);
    expect(chat.headers.get("content-type")).toContain("text/event-stream");
    expect(chat.headers.get("access-control-allow-origin")).toBe(siteUrl);
    expect(sseContents(chat.text)).toEqual(["Hello ", "traveller"]);

    await waitFor(async () => {
      const rows = await readMessagesAs(gm, conversationId);
      return rows.length === 2 ? rows : null;
    });
    expect(await readMessagesAs(gm, conversationId)).toEqual([
      { role: "user", content: "What happens next?", stopped_partway: false },
      { role: "assistant", content: "Hello traveller", stopped_partway: false },
    ]);

    // The fake saw the server-side request: the default model, the caller's
    // JWT nowhere near it, and the system prompt naming this copy's game
    // system with drafting-only instructions.
    const received = fake?.receivedChats.at(-1);
    expect(received?.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    const body = received?.body as {
      model?: string;
      messages?: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe(FAKE_CHAT_MODEL);
    expect(body.messages?.[0]?.role).toBe("system");
    const systemLabel = gameSystem === "starforged" ? "Starforged" : "Ironsworn";
    expect(body.messages?.[0]?.content).toContain(systemLabel);
    expect(body.messages?.[0]?.content.toLowerCase()).toContain("draft");
    expect(body.messages?.at(-1)).toMatchObject({
      role: "user",
      content: "What happens next?",
    });
  });

  it("refuses a player, an outsider and an anonymous caller", { timeout: 180000 }, async () => {
    await ensureConfigured();
    const { gm, player, outsider, campaignId } = await setUpCampaign();
    await signInAs(gm);
    const conversationId = await createConversation({ campaignId, title: "Private" });
    await signOut();
    const playerToken = await personToken(player);
    const outsiderToken = await personToken(outsider);

    for (const token of [playerToken, outsiderToken]) {
      const chat = await call("/gm-assistant/chat", {
        token,
        body: { conversationId, message: "Sneaky" },
      });
      expect(chat.status).toBe(404);
      expect(JSON.parse(chat.text)).toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

      const models = await call(`/gm-assistant/models?campaignId=${campaignId}`, { token });
      expect(models.status).toBe(403);
      expect(JSON.parse(models.text)).toMatchObject({ code: "FORBIDDEN" });
    }

    const anonChat = await call("/gm-assistant/chat", {
      body: { conversationId, message: "Sneaky" },
    });
    expect(anonChat.status).toBe(401);
    expect(JSON.parse(anonChat.text)).toMatchObject({ code: "UNAUTHORIZED" });

    const anonModels = await call(`/gm-assistant/models?campaignId=${campaignId}`);
    expect(anonModels.status).toBe(401);

    // The player learns nothing through the data layer either.
    expect(await readMessagesAs(player, conversationId)).toEqual([]);
  });

  it("filters the model list by the allow-list with context sizes", { timeout: 120000 }, async () => {
    await ensureConfigured();
    const { gm, campaignId } = await setUpCampaign();
    const token = await personToken(gm);
    const models = await call(`/gm-assistant/models?campaignId=${campaignId}`, { token });
    expect(models.status).toBe(200);
    expect(JSON.parse(models.text)).toEqual({
      models: [
        { id: FAKE_CHAT_MODEL, context_tokens: 4096 },
        { id: FAKE_OTHER_MODEL, context_tokens: 8192 },
      ],
    });
  });

  it("stopping cancels the upstream request and keeps the partial", { timeout: 180000 }, async () => {
    await ensureConfigured();
    const upstream = fake;
    if (!upstream) throw new Error("fake upstream not running");
    upstream.mode = "stall";
    try {
      const { gm, campaignId } = await setUpCampaign();
      await signInAs(gm);
      const conversationId = await createConversation({ campaignId, title: "Slow story" });
      await signOut();
      const token = await personToken(gm);

      const controller = new AbortController();
      const pending = call("/gm-assistant/chat", {
        token,
        body: { conversationId, message: "Take your time" },
        signal: controller.signal,
      });
      // Wait until the function is actually proxying before hanging up: the
      // stall mode sends one chunk first.
      const started = Date.now();
      for (;;) {
        const last = upstream.receivedChats.at(-1);
        if (last && (last.body.messages as unknown[])?.length > 0) break;
        if (Date.now() - started > 60000) throw new Error("upstream chat never started");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      controller.abort();
      await pending.catch(() => undefined);

      await waitFor(async () => {
        const last = upstream.receivedChats.at(-1);
        return last?.aborted ? true : null;
      });
      expect(upstream.receivedChats.at(-1)?.aborted).toBe(true);

      const rows = await waitFor(async () => {
        const seen = await readMessagesAs(gm, conversationId);
        return seen.length === 2 && seen[1].stopped_partway ? seen : null;
      });
      expect(rows?.[0].content).toBe("Take your time");
      expect(rows?.[1].role).toBe("assistant");
      expect(rows?.[1].stopped_partway).toBe(true);
      expect(rows?.[1].content.length).toBeGreaterThan(0);
    } finally {
      upstream.mode = "ok";
    }
  });

  it("reports upstream failures generically with a reference", { timeout: 180000 }, async () => {
    await ensureConfigured();
    const failing = fake;
    if (!failing) throw new Error("fake upstream not running");
    failing.mode = "fail";
    try {
      const { gm, campaignId } = await setUpCampaign();
      await signInAs(gm);
      const conversationId = await createConversation({ campaignId, title: "Doomed" });
      await signOut();
      const token = await personToken(gm);

      const chat = await call("/gm-assistant/chat", {
        token,
        body: { conversationId, message: "hi" },
      });
      expect(chat.status).toBe(502);
      const body = JSON.parse(chat.text) as { code: string; message: string; ref: string };
      expect(body.code).toBe("UPSTREAM_ERROR");
      expect(body.ref).toMatch(/^[0-9A-Z]{6}$/);
      expect(chat.text).not.toContain(TEST_API_KEY);
    } finally {
      failing.mode = "ok";
    }
  });

  it("never exposes the API key in any response", () => {
    expect(seen.length).toBeGreaterThan(0);
    for (const result of seen) {
      expect(result.text).not.toContain(TEST_API_KEY);
      result.headers.forEach((value) => {
        expect(value).not.toContain(TEST_API_KEY);
      });
    }
  });
});
