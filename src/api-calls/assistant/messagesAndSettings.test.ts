import { beforeEach, describe, expect, it, vi } from "vitest";

import { addAssistantMessage } from "api-calls/assistant/addAssistantMessage";
import {
  fetchAssistantSettings,
  saveAssistantSettings,
} from "api-calls/assistant/assistantSettings";
import { emptyAssistantContextChoice } from "api-calls/assistant/_assistant.type";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

// Seam under test: message and settings writes carry client-generated ids
// and the signed-in GM, and settings read back exactly the model and
// context choice the GM saved. The access rules behind them are covered by
// the live tests; here the client is a stub.
const state = {
  inserted: [] as Array<{ table: string; row: Record<string, unknown> }>,
  upserted: [] as Array<{ table: string; row: Record<string, unknown> }>,
  settingsRow: null as Record<string, unknown> | null,
};

beforeEach(() => {
  state.inserted = [];
  state.upserted = [];
  state.settingsRow = null;
  mockedGetSupabaseClient.mockReturnValue({
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { id: "gm-1" } } },
          error: null,
        }),
    },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push({ table, row });
        return { data: null, error: null };
      },
      upsert: async (row: Record<string, unknown>) => {
        state.upserted.push({ table, row });
        return { data: null, error: null };
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: state.settingsRow, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("assistant messages and settings", () => {
  it("adds a user message to the conversation", async () => {
    const id = await addAssistantMessage({
      conversationId: "conversation-1",
      role: "user",
      content: "  What happens next?  ",
    });

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]?.table).toBe("assistant_messages");
    expect(state.inserted[0]?.row).toMatchObject({
      id,
      conversation_id: "conversation-1",
      role: "user",
      content: "What happens next?",
      stopped_partway: false,
    });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("refuses messages with no conversation, no text or a bad role", async () => {
    await expect(
      addAssistantMessage({
        conversationId: "  ",
        role: "user",
        content: "Hello",
      })
    ).rejects.toThrow(/conversation/i);
    await expect(
      addAssistantMessage({
        conversationId: "conversation-1",
        role: "user",
        content: "   ",
      })
    ).rejects.toThrow(/content|text/i);
    await expect(
      addAssistantMessage({
        conversationId: "conversation-1",
        role: "villain" as unknown as "user",
        content: "Hello",
      })
    ).rejects.toThrow(/role/i);
    expect(state.inserted).toEqual([]);
  });

  it("returns null settings until the GM saves a choice", async () => {
    await expect(
      fetchAssistantSettings({ campaignId: "campaign-1" })
    ).resolves.toBeNull();
  });

  it("saves the model and context choice and reads them back", async () => {
    const context = {
      ...emptyAssistantContextChoice(),
      includeOutline: true,
      channels: [{ id: "channel-1", postCount: 5 }],
    };
    await saveAssistantSettings({
      campaignId: "campaign-1",
      model: "test-model",
      context,
    });

    expect(state.upserted).toHaveLength(1);
    expect(state.upserted[0]?.table).toBe("assistant_settings");
    expect(state.upserted[0]?.row).toMatchObject({
      campaign_id: "campaign-1",
      gm_id: "gm-1",
      model: "test-model",
      context,
    });

    state.settingsRow = {
      campaign_id: "campaign-1",
      gm_id: "gm-1",
      model: "test-model",
      context,
      created_at: "2026-11-14T12:00:00.000Z",
      updated_at: "2026-11-14T12:00:00.000Z",
    };
    await expect(
      fetchAssistantSettings({ campaignId: "campaign-1" })
    ).resolves.toEqual({
      model: "test-model",
      context,
      updatedAt: "2026-11-14T12:00:00.000Z",
    });
  });

  it("saves clearing the model choice back to null", async () => {
    await saveAssistantSettings({
      campaignId: "campaign-1",
      model: null,
      context: emptyAssistantContextChoice(),
    });

    expect(state.upserted[0]?.row).toMatchObject({ model: null });
  });
});
