import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import type {
  AssistantContextChoice,
  AssistantConversationDocument,
  AssistantMessageDocument,
  AssistantMessageRole,
  AssistantProposalState,
  AssistantSettingsDocument,
} from "api-calls/assistant/_assistant.type";

/**
 * Identifiers and row mapping for the GM assistant: one conversation row
 * per GM-started thread, one message row per turn, one settings row per
 * (campaign, GM) holding the model and the saved context choice, and one
 * row per kept outline version holding replaced outline text for Undo.
 * The data
 * layer is the only place that names these tables, the live-update channels
 * and the row filters; stores, tabs and components only ever see
 * conversation, message, settings and version documents.
 */

export const ASSISTANT_CONVERSATIONS_TABLE = "assistant_conversations";
export const ASSISTANT_MESSAGES_TABLE = "assistant_messages";
export const ASSISTANT_SETTINGS_TABLE = "assistant_settings";
export const ASSISTANT_OUTLINE_VERSIONS_TABLE = "assistant_outline_versions";

/**
 * One shared shape behind the four channel/filter pairs below: every
 * assistant live-update channel is `<prefix>:<id>` with a matching
 * `<column>=eq.<id>` row filter. The named wrappers keep the per-table
 * prefix and column beside their table; the bodies share this helper so
 * the shape cannot drift between families. No behavior change.
 */
function assistantChannelName(prefix: string, id: string): string {
  return `${prefix}:${id}`;
}

function assistantChannelFilter(column: string, id: string): string {
  return `${column}=eq.${id}`;
}

/**
 * One shared shape behind the four payload mappers below: deletes map to
 * a removal keyed by the row's key, anything else maps to an upsert when
 * the key is present. The per-table wrappers only supply how to read the
 * key; the branching stays here. No behavior change.
 */
function rowPayloadToChange<Row>(
  payload: PostgresChangePayload<Row>,
  getKey: (partial: Partial<Row>) => string | null
): RowChange<Row> | null {
  if (payload.eventType === "DELETE") {
    const key = getKey((payload.old ?? {}) as Partial<Row>);
    return key !== null ? { kind: "remove", key } : null;
  }
  const key = getKey(payload.new as Partial<Row>);
  return key !== null
    ? { kind: "upsert", row: payload.new as Row }
    : null;
}

function idKey(partial: { id?: unknown }): string | null {
  return typeof partial.id === "string" ? partial.id : null;
}

export interface AssistantOutlineVersionRow {
  id: string;
  campaign_id: string;
  created_by: string | null;
  content: string;
  created_at: string;
}

export interface AssistantOutlineVersion {
  id: string;
  campaignId: string;
  content: string;
  createdBy: string | null;
  createdAt: string;
}

export function outlineVersionRowToDocument(
  row: AssistantOutlineVersionRow
): AssistantOutlineVersion {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function constructAssistantOutlineVersionsChannelName(
  campaignId: string
): string {
  return assistantChannelName("assistant-outline-versions", campaignId);
}

export function constructAssistantOutlineVersionsFilter(
  campaignId: string
): string {
  return assistantChannelFilter("campaign_id", campaignId);
}

export function assistantOutlineVersionPayloadToChange(
  payload: PostgresChangePayload<AssistantOutlineVersionRow>
): RowChange<AssistantOutlineVersionRow> | null {
  return rowPayloadToChange(payload, idKey);
}

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
  role: AssistantMessageRole;
  content: string;
  stopped_partway: boolean;
  proposal_state: AssistantProposalState | null;
  applied_version_id: string | null;
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
  return assistantChannelName("assistant-conversations", campaignId);
}

export function constructAssistantConversationsFilter(
  campaignId: string
): string {
  return assistantChannelFilter("campaign_id", campaignId);
}

export function constructAssistantMessagesChannelName(
  conversationId: string
): string {
  return assistantChannelName("assistant-messages", conversationId);
}

export function constructAssistantMessagesFilter(
  conversationId: string
): string {
  return assistantChannelFilter("conversation_id", conversationId);
}

// There is deliberately no assistant-settings channel constructor: no
// listener opens assistant-settings:<campaignId> — settings are read and
// saved over REST, and the realtime allowlist dropped the speculative
// entry (migration 20261121000007_realtime_assistant_prune_settings.sql).

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
  if (row.role === "assistant") {
    return "assistant";
  }
  if (row.role === "user") {
    return "user";
  }
  throw new Error(
    `Unknown assistant message role: ${String(
      (row as { role?: unknown }).role
    )}`
  );
}

export function messageRowToDocument(
  row: AssistantMessageRow
): AssistantMessageDocument {
  return {
    role: roleOf(row),
    content: row.content,
    stoppedPartway: row.stopped_partway,
    proposalState: row.proposal_state ?? null,
    appliedVersionId: row.applied_version_id ?? null,
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
  return rowPayloadToChange(payload, idKey);
}

export function assistantMessagePayloadToChange(
  payload: PostgresChangePayload<AssistantMessageRow>
): RowChange<AssistantMessageRow> | null {
  return rowPayloadToChange(payload, idKey);
}

export function assistantSettingsPayloadToChange(
  payload: PostgresChangePayload<AssistantSettingsRow>
): RowChange<AssistantSettingsRow> | null {
  return rowPayloadToChange(
    payload,
    (partial) =>
      typeof partial.campaign_id === "string" &&
      typeof partial.gm_id === "string"
        ? `${partial.campaign_id}:${partial.gm_id}`
        : null
  );
}
