import { describe, expect, it } from "vitest";

import {
  ASSISTANT_CONVERSATIONS_TABLE,
  ASSISTANT_MESSAGES_TABLE,
  ASSISTANT_SETTINGS_TABLE,
  assistantConversationPayloadToChange,
  assistantMessagePayloadToChange,
  assistantSettingsPayloadToChange,
  conversationRowToDocument,
  constructAssistantConversationsChannelName,
  constructAssistantConversationsFilter,
  constructAssistantMessagesChannelName,
  constructAssistantMessagesFilter,
  constructAssistantSettingsChannelName,
  constructAssistantSettingsFilter,
  messageRowToDocument,
  settingsRowToDocument,
  type AssistantConversationRow,
  type AssistantMessageRow,
  type AssistantSettingsRow,
} from "api-calls/assistant/_getRef";

// Seam under test: the assistant data layer is the only place that names
// the conversations, messages and settings tables, their live-update
// channels and their row shapes. Stores and components only ever see
// conversation, message and settings documents.
function conversationRow(
  overrides: Partial<AssistantConversationRow> = {}
): AssistantConversationRow {
  return {
    id: "conversation-1",
    campaign_id: "campaign-1",
    owner_id: "gm-1",
    title: "Story planning",
    created_at: "2026-11-14T12:00:00.000Z",
    updated_at: "2026-11-14T12:00:00.000Z",
    ...overrides,
  };
}

function messageRow(
  overrides: Partial<AssistantMessageRow> = {}
): AssistantMessageRow {
  return {
    id: "message-1",
    conversation_id: "conversation-1",
    role: "user",
    content: "What happens next?",
    stopped_partway: false,
    created_at: "2026-11-14T12:00:00.000Z",
    updated_at: "2026-11-14T12:00:00.000Z",
    ...overrides,
  };
}

function settingsRow(
  overrides: Partial<AssistantSettingsRow> = {}
): AssistantSettingsRow {
  return {
    campaign_id: "campaign-1",
    gm_id: "gm-1",
    model: "test-model",
    context: {
      includeOutline: true,
      lore: [{ id: "lore-1", includeGmParts: true }],
      npcs: [],
      locations: [],
      notes: ["note-1"],
      channels: [{ id: "channel-1", postCount: 10 }],
    },
    created_at: "2026-11-14T12:00:00.000Z",
    updated_at: "2026-11-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("assistant refs", () => {
  it("names the conversations, messages and settings tables", () => {
    expect(ASSISTANT_CONVERSATIONS_TABLE).toBe("assistant_conversations");
    expect(ASSISTANT_MESSAGES_TABLE).toBe("assistant_messages");
    expect(ASSISTANT_SETTINGS_TABLE).toBe("assistant_settings");
  });

  it("names one live-update channel per campaign and conversation", () => {
    expect(constructAssistantConversationsChannelName("campaign-1")).toBe(
      "assistant-conversations:campaign-1"
    );
    expect(constructAssistantConversationsFilter("campaign-1")).toBe(
      "campaign_id=eq.campaign-1"
    );
    expect(constructAssistantMessagesChannelName("conversation-1")).toBe(
      "assistant-messages:conversation-1"
    );
    expect(constructAssistantMessagesFilter("conversation-1")).toBe(
      "conversation_id=eq.conversation-1"
    );
    expect(constructAssistantSettingsChannelName("campaign-1")).toBe(
      "assistant-settings:campaign-1"
    );
    expect(constructAssistantSettingsFilter("campaign-1")).toBe(
      "campaign_id=eq.campaign-1"
    );
  });

  it("reads a conversation row as the document the list shows", () => {
    expect(conversationRowToDocument(conversationRow())).toEqual({
      title: "Story planning",
      createdAt: "2026-11-14T12:00:00.000Z",
      updatedAt: "2026-11-14T12:00:00.000Z",
    });
  });

  it("reads a message row with its role and stopped flag", () => {
    expect(messageRowToDocument(messageRow())).toEqual({
      role: "user",
      content: "What happens next?",
      stoppedPartway: false,
      createdAt: "2026-11-14T12:00:00.000Z",
    });
  });

  it("refuses an unknown message role instead of defaulting to user", () => {
    const bad = messageRow({
      role: "villain" as unknown as "user",
    });
    expect(() => messageRowToDocument(bad)).toThrow(/role/i);
  });

  it("reads a settings row with its model and context choice", () => {
    expect(settingsRowToDocument(settingsRow())).toEqual({
      model: "test-model",
      context: {
        includeOutline: true,
        lore: [{ id: "lore-1", includeGmParts: true }],
        npcs: [],
        locations: [],
        notes: ["note-1"],
        channels: [{ id: "channel-1", postCount: 10 }],
      },
      updatedAt: "2026-11-14T12:00:00.000Z",
    });
  });

  it("maps deletes to removals keyed by row id", () => {
    expect(
      assistantConversationPayloadToChange({
        eventType: "DELETE",
        new: {},
        old: { id: "conversation-1" },
      })
    ).toEqual({ kind: "remove", key: "conversation-1" });
    expect(
      assistantMessagePayloadToChange({
        eventType: "DELETE",
        new: {},
        old: { id: "message-1" },
      })
    ).toEqual({ kind: "remove", key: "message-1" });
    expect(
      assistantSettingsPayloadToChange({
        eventType: "DELETE",
        new: {},
        old: { campaign_id: "campaign-1", gm_id: "gm-1" },
      })
    ).toEqual({ kind: "remove", key: "campaign-1:gm-1" });
  });

  it("maps upserts through for live rows", () => {
    const conversation = conversationRow();
    expect(
      assistantConversationPayloadToChange({
        eventType: "INSERT",
        new: conversation,
        old: null,
      })
    ).toEqual({ kind: "upsert", row: conversation });
    const message = messageRow();
    expect(
      assistantMessagePayloadToChange({
        eventType: "INSERT",
        new: message,
        old: null,
      })
    ).toEqual({ kind: "upsert", row: message });
    const settings = settingsRow();
    expect(
      assistantSettingsPayloadToChange({
        eventType: "INSERT",
        new: settings,
        old: null,
      })
    ).toEqual({ kind: "upsert", row: settings });
  });
});
