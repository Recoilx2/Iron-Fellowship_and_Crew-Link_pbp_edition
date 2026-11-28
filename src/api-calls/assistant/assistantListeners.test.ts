import { afterEach, describe, expect, it, vi } from "vitest";

import { listenToConversations } from "api-calls/assistant/listenToConversations";
import { listenToMessages } from "api-calls/assistant/listenToMessages";
import type {
  AssistantConversationRow,
  AssistantMessageRow,
} from "api-calls/assistant/_getRef";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedClient = vi.mocked(getSupabaseClient);

// Seam under test: each listener fetches its own rows (the campaign's
// conversations, one conversation's messages) and hands documents to the
// subscriber. Row delivery stays governed by the access rules; here the
// realtime channel and the tables are stubs.
type StatusCallback = (status: string, error?: unknown) => void;

interface StubState {
  seenFrom: string[];
  seenEq: Array<{ column: string; value: string }>;
  seenChannelNames: string[];
  conversationRows: AssistantConversationRow[];
  messageRows: AssistantMessageRow[];
  subscribeCbs: StatusCallback[];
}

function setUpClient(): StubState {
  const state: StubState = {
    seenFrom: [],
    seenEq: [],
    seenChannelNames: [],
    conversationRows: [],
    messageRows: [],
    subscribeCbs: [],
  };
  const channel = {
    on: () => channel,
    subscribe: (cb: StatusCallback) => {
      state.subscribeCbs.push(cb);
      return channel;
    },
  };
  const query = (table: string) => ({
    select: () => ({
      eq: (column: string, value: string) => {
        state.seenEq.push({ column, value });
        // Messages resolve their campaign topic through the conversation
        // row; return a thenable for that one-column lookup.
        if (table === "assistant_conversations" && column === "id") {
          return Promise.resolve({
            data: state.conversationRows.map((row) => ({
              campaign_id: row.campaign_id,
            })),
            error: null,
          }) as never;
        }
        return {
          eq: (column2: string, value2: string) => {
            state.seenEq.push({ column: column2, value: value2 });
            return Promise.resolve({ data: [], error: null });
          },
          order: () =>
            Promise.resolve({
              data:
                table === "assistant_conversations"
                  ? state.conversationRows
                  : state.messageRows,
              error: null,
            }),
        };
      },
    }),
  });
  mockedClient.mockReturnValue({
    channel: (name: string) => {
      state.seenChannelNames.push(name);
      return channel;
    },
    from: (table: string) => {
      state.seenFrom.push(table);
      return query(table);
    },
    removeChannel: () => Promise.resolve("ok"),
  } as never);
  return state;
}

function fireSubscribed(state: StubState) {
  for (const cb of state.subscribeCbs.splice(0)) {
    cb("SUBSCRIBED");
  }
}

describe("assistant listeners", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists the campaign's conversations and reports them with ids", async () => {
    const client = setUpClient();
    client.conversationRows = [
      {
        id: "conversation-1",
        campaign_id: "campaign-1",
        owner_id: "gm-1",
        title: "Story planning",
        created_at: "2026-11-14T12:00:00.000Z",
        updated_at: "2026-11-14T12:00:00.000Z",
      },
    ];
    const onConversations = vi.fn();
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const unsubscribe = listenToConversations(
      "campaign-1",
      { onConversations, onLoaded },
      onError
    );

    fireSubscribed(client);
    await vi.waitFor(() => {
      expect(onConversations).toHaveBeenCalled();
    });
    expect(client.seenFrom).toContain("assistant_conversations");
    expect(client.seenEq).toContainEqual({
      column: "campaign_id",
      value: "campaign-1",
    });
    expect(onConversations).toHaveBeenLastCalledWith([
      {
        id: "conversation-1",
        campaignId: "campaign-1",
        ownerId: "gm-1",
        title: "Story planning",
        createdAt: "2026-11-14T12:00:00.000Z",
        updatedAt: "2026-11-14T12:00:00.000Z",
      },
    ]);
    expect(onLoaded).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("refuses to listen without a campaign or a conversation", () => {
    const onError = vi.fn();
    listenToConversations("", { onConversations: () => {}, onLoaded: () => {} }, onError);
    expect(onError).toHaveBeenCalled();
    listenToMessages("", { onMessages: () => {}, onLoaded: () => {} }, onError);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("lists one conversation's messages oldest first", async () => {
    const client = setUpClient();
    client.messageRows = [
      {
        id: "message-1",
        conversation_id: "conversation-1",
        role: "user",
        content: "First",
        stopped_partway: false,
        proposal_state: null,
        applied_version_id: null,
        created_at: "2026-11-14T12:00:00.000Z",
        updated_at: "2026-11-14T12:00:00.000Z",
      },
      {
        id: "message-2",
        conversation_id: "conversation-1",
        role: "assistant",
        content: "Second",
        stopped_partway: true,
        proposal_state: null,
        applied_version_id: null,
        created_at: "2026-11-14T12:01:00.000Z",
        updated_at: "2026-11-14T12:01:00.000Z",
      },
    ];
    const onMessages = vi.fn();
    const onLoaded = vi.fn();
    const unsubscribe = listenToMessages(
      "conversation-1",
      { onMessages, onLoaded },
      () => {}
    );

    // The broadcast topic needs a one-row campaign lookup first; wait for
    // the channel before announcing SUBSCRIBED.
    await vi.waitFor(() => {
      expect(client.subscribeCbs.length).toBeGreaterThan(0);
    });
    fireSubscribed(client);
    await vi.waitFor(() => {
      expect(onMessages).toHaveBeenCalled();
    });
    expect(client.seenFrom).toContain("assistant_messages");
    expect(client.seenEq).toContainEqual({
      column: "conversation_id",
      value: "conversation-1",
    });
    expect(onMessages).toHaveBeenLastCalledWith([
      {
        id: "message-1",
        conversationId: "conversation-1",
        role: "user",
        content: "First",
        stoppedPartway: false,
        proposalState: null,
        appliedVersionId: null,
        createdAt: "2026-11-14T12:00:00.000Z",
      },
      {
        id: "message-2",
        conversationId: "conversation-1",
        role: "assistant",
        content: "Second",
        stoppedPartway: true,
        proposalState: null,
        appliedVersionId: null,
        createdAt: "2026-11-14T12:01:00.000Z",
      },
    ]);
    expect(onLoaded).toHaveBeenCalled();
    unsubscribe();
  });
});
