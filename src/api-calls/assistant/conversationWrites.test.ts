import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConversation } from "api-calls/assistant/createConversation";
import { renameConversation } from "api-calls/assistant/renameConversation";
import { deleteConversation } from "api-calls/assistant/deleteConversation";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

// Seam under test: the conversation writes carry a client-generated id and
// the signed-in GM as owner, and surface a missing conversation instead of
// silently succeeding. The access rules behind the write are covered by the
// live tests; here the client is a stub.
interface CapturedInsert {
  table: string;
  row: Record<string, unknown>;
}

const state = {
  inserted: [] as CapturedInsert[],
  updated: [] as Array<{ table: string; columns: Record<string, unknown> }>,
  updateResult: [{ id: "conversation-1" }] as Array<{ id: string }>,
  deleted: [] as string[],
  deleteResult: [{ id: "conversation-1" }] as Array<{ id: string }>,
};

beforeEach(() => {
  state.inserted = [];
  state.updated = [];
  state.updateResult = [{ id: "conversation-1" }];
  state.deleted = [];
  state.deleteResult = [{ id: "conversation-1" }];
  mockedGetSupabaseClient.mockReturnValue({
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { id: "gm-1" } } },
          error: null,
        }),
    },
    from: (table: string) => ({
      // No .select() chain on insert: the row id is client-generated, so
      // the insert needs no RETURNING clause (notes convention, #69).
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push({ table, row });
        return { data: null, error: null };
      },
      update: (columns: Record<string, unknown>) => {
        state.updated.push({ table, columns });
        return {
          eq: () => ({
            select: () =>
              Promise.resolve({
                data: state.updateResult,
                error: null,
              }),
          }),
        };
      },
      delete: () => {
        state.deleted.push(table);
        return {
          eq: () => ({
            select: () =>
              Promise.resolve({ data: state.deleteResult, error: null }),
          }),
        };
      },
    }),
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("assistant conversation writes", () => {
  it("creates a conversation owned by the signed-in GM", async () => {
    const id = await createConversation({
      campaignId: "campaign-1",
      title: "  Story planning  ",
    });

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]?.table).toBe("assistant_conversations");
    expect(state.inserted[0]?.row).toMatchObject({
      id,
      campaign_id: "campaign-1",
      owner_id: "gm-1",
      title: "Story planning",
    });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("titles an untitled conversation without sending an empty title", async () => {
    await createConversation({ campaignId: "campaign-1" });

    expect(state.inserted[0]?.row.title).toBe("New conversation");
  });

  it("refuses to create a conversation without a campaign", async () => {
    await expect(
      createConversation({ campaignId: "  " })
    ).rejects.toThrow(/campaign/i);
    expect(state.inserted).toEqual([]);
  });

  it("renames the GM's conversation", async () => {
    await renameConversation({
      conversationId: "conversation-1",
      title: "  Revised plan  ",
    });

    expect(state.updated).toEqual([
      {
        table: "assistant_conversations",
        columns: { title: "Revised plan" },
      },
    ]);
  });

  it("refuses an empty conversation title", async () => {
    await expect(
      renameConversation({ conversationId: "conversation-1", title: "  " })
    ).rejects.toThrow(/title/i);
    expect(state.updated).toEqual([]);
  });

  it("reports a conversation nobody owns as not found", async () => {
    state.updateResult = [];
    await expect(
      renameConversation({ conversationId: "conversation-1", title: "Plan" })
    ).rejects.toThrow(/not found/i);
  });

  it("deletes the GM's conversation with its messages following", async () => {
    await deleteConversation({ conversationId: "conversation-1" });

    // One delete on the conversations table: the messages follow through
    // the database cascade, so the client never deletes them one by one.
    expect(state.deleted).toEqual(["assistant_conversations"]);
  });

  it("reports deleting a conversation nobody owns as not found", async () => {
    state.deleteResult = [];
    await expect(
      deleteConversation({ conversationId: "conversation-1" })
    ).rejects.toThrow(/not found/i);
  });
});
