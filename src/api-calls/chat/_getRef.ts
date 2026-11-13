import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import type {
  ChannelDocument,
  ChannelKind,
  ChannelVisibility,
} from "api-calls/chat/_chat.type";

/**
 * Identifiers and row mapping for chat channels and their roster. The data
 * layer is the only place that names the channels table, the roster table,
 * the live-update channels and the channel filters; stores, tabs and
 * components only ever see channel documents and member lists.
 */

export const CHAT_CHANNELS_TABLE = "chat_channels";
export const CHAT_CHANNEL_MEMBERS_TABLE = "chat_channel_members";

export interface ChannelRow {
  id: string;
  campaign_id: string;
  name: string;
  kind: string;
  visibility: string;
  is_starting: boolean;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelMemberRow {
  channel_id: string;
  user_id: string;
  created_at: string;
}

export function constructCampaignChannelsChannelName(
  campaignId: string
): string {
  return `campaign-channels:${campaignId}`;
}

export function constructCampaignChannelsFilter(campaignId: string): string {
  return `campaign_id=eq.${campaignId}`;
}

/**
 * The roster follows the whole campaign, not one channel: membership rows
 * arrive unfiltered and merge by channel, while each row's delivery stays
 * governed by the channel access rules (a GM who is not in a direct
 * channel never receives its roster). The roster channel shares the dash family of the
 * channel list, so it joins under the same realtime authorization.
 */
export function constructCampaignChannelMembersChannelName(
  campaignId: string
): string {
  return `campaign-channel-members:${campaignId}`;
}

function visibilityOf(row: ChannelRow): ChannelVisibility {
  return row.visibility === "private" || row.visibility === "dm"
    ? row.visibility
    : "public";
}

export function channelRowToDocument(row: ChannelRow): ChannelDocument {
  return {
    name: row.name,
    kind: row.kind as ChannelKind,
    visibility: visibilityOf(row),
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

export function channelMemberPayloadToChange(
  payload: PostgresChangePayload<ChannelMemberRow>
): RowChange<ChannelMemberRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<ChannelMemberRow>;
    return typeof old.channel_id === "string" &&
      typeof old.user_id === "string"
      ? {
          kind: "remove",
          key: `${old.channel_id}:${old.user_id}`,
        }
      : null;
  }
  const row = payload.new as Partial<ChannelMemberRow>;
  return row &&
    typeof row.channel_id === "string" &&
    typeof row.user_id === "string"
    ? { kind: "upsert", row: row as ChannelMemberRow }
    : null;
}
