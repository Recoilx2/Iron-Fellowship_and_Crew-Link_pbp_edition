import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import type { ChannelDocument, ChannelKind } from "api-calls/chat/_chat.type";

/**
 * Identifiers and row mapping for chat channels. The data layer is the only
 * place that names the channels table, the live-update channel and the
 * channel filter; stores, tabs and components stay backend-free.
 */

export const CHAT_CHANNELS_TABLE = "chat_channels";

export interface ChannelRow {
  id: string;
  campaign_id: string;
  name: string;
  kind: string;
  is_starting: boolean;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function constructCampaignChannelsChannelName(
  campaignId: string
): string {
  return `campaign-channels:${campaignId}`;
}

export function constructCampaignChannelsFilter(campaignId: string): string {
  return `campaign_id=eq.${campaignId}`;
}

export function channelRowToDocument(row: ChannelRow): ChannelDocument {
  return {
    name: row.name,
    kind: row.kind as ChannelKind,
    isStarting: row.is_starting,
    archived: row.archived,
  };
}

export function channelPayloadToChange(
  payload: PostgresChangePayload<ChannelRow>
): RowChange<ChannelRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<ChannelRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<ChannelRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as ChannelRow }
    : null;
}
