import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import type {
  AssistantContextChoice,
  AssistantConversationDocument,
  AssistantMessageDocument,
  AssistantMessageRole,
  AssistantSettingsDocument,
} from "api-calls/assistant/_assistant.type";

/**
 * Identifiers and row mapping for the GM assistant: one conversation row
 * per GM-started thread, one message row per turn, and one settings row per
 * (campaign, GM) holding the model and the saved context choice. The data
 * layer is the only place that names these tables, the live-update channels
 * and the row filters; stores, tabs and components only ever see
 * conversation, message and settings documents.
 */

export const ASSISTANT_CONVERSATIONS_TABLE = "assistant_conversations";
export const ASSISTANT_MESSAGES_TABLE = "assistant_messages";
export const ASSISTANT_SETTINGS_TABLE = "assistant_settings";

export interface AssistantConversationRow {
  id: string;
  campaign_id: string;
  owner_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AssistantMessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  stopped_partway: boolean;
  created_at: string;
  updated_at: string;
}

export interface AssistantSettingsRow {
  campaign_id: string;
  gm_id: string;
  model: string | null;
  context: AssistantContextChoice;
  created_at: string;
  updated_at: string;
}

export function constructAssistantConversationsChannelName(
  campaignId: string
): string {
  return `assistant-conversations:${campaignId}`;
}

export function constructAssistantConversationsFilter(
  campaignId: string
): string {
  return `campaign_id=eq.${campaignId}`;
}

export function constructAssistantMessagesChannelName(
  conversationId: string
): string {
  return `assistant-messages:${conversationId}`;
}

export function constructAssistantMessagesFilter(
  conversationId: string
): string {
  return `conversation_id=eq.${conversationId}`;
}

export function constructAssistantSettingsChannelName(
  campaignId: string
): string {
  return `assistant-settings:${campaignId}`;
}

export function constructAssistantSettingsFilter(campaignId: string): string {
  return `campaign_id=eq.${campaignId}`;
}

export function conversationRowToDocument(
  row: AssistantConversationRow
): AssistantConversationDocument {
  return {
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function roleOf(row: AssistantMessageRow): AssistantMessageRole {
  return row.role === "assistant" ? "assistant" : "user";
}

export function messageRowToDocument(
  row: AssistantMessageRow
): AssistantMessageDocument {
  return {
    role: roleOf(row),
    content: row.content,
    stoppedPartway: row.stopped_partway,
    createdAt: row.created_at,
  };
}

export function settingsRowToDocument(
  row: AssistantSettingsRow
): AssistantSettingsDocument {
  return {
    model: row.model,
    context: row.context,
    updatedAt: row.updated_at,
  };
}

/**
 * Columns for saving a GM's settings: the chosen model (or null until they
 * choose one) beside the saved context choice, which carries references
 * only, never text.
 */
export function settingsDocumentToColumns(params: {
  model: string | null;
  context: AssistantContextChoice;
}): Pick<AssistantSettingsRow, "model" | "context"> {
  return { model: params.model, context: params.context };
}

export function assistantConversationPayloadToChange(
  payload: PostgresChangePayload<AssistantConversationRow>
): RowChange<AssistantConversationRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<AssistantConversationRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<AssistantConversationRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as AssistantConversationRow }
    : null;
}

export function assistantMessagePayloadToChange(
  payload: PostgresChangePayload<AssistantMessageRow>
): RowChange<AssistantMessageRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<AssistantMessageRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<AssistantMessageRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as AssistantMessageRow }
    : null;
}

export function assistantSettingsPayloadToChange(
  payload: PostgresChangePayload<AssistantSettingsRow>
): RowChange<AssistantSettingsRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<AssistantSettingsRow>;
    return typeof old.campaign_id === "string" &&
      typeof old.gm_id === "string"
      ? { kind: "remove", key: `${old.campaign_id}:${old.gm_id}` }
      : null;
  }
  const row = payload.new as Partial<AssistantSettingsRow>;
  return row &&
    typeof row.campaign_id === "string" &&
    typeof row.gm_id === "string"
    ? { kind: "upsert", row: row as AssistantSettingsRow }
    : null;
}
