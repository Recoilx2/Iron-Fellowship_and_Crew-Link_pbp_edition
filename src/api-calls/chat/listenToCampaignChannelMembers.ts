import { getSupabaseClient } from "config/supabase.config";
import type { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import {
  CHAT_CHANNELS_TABLE,
  CHAT_CHANNEL_MEMBERS_TABLE,
  constructCampaignChannelMembersChannelName,
  constructCampaignChannelsFilter,
  type ChannelMemberRow,
} from "./_getRef";

/**
 * Follows the roster of every visible channel in one campaign. Private
 * channel members and GMs see private rosters; a direct channel's two
 * members alone see theirs, so a GM who is not in one never learns it
 * exists. Members join
 * and leave live; outsiders see nothing, because the roster access rules
 * (not an interface filter) decide which rows arrive. Returns a plain
 * unsubscribe function.
 *
 * The roster rows themselves carry no live stream: the roster table left
 * the realtime publication (#117), because membership DELETEs skip
 * row-level security and reached subscribers outside the channel. Every
 * roster write instead bumps the parent channel's updated_at, so this
 * listener watches the campaign's channels and re-fetches the roster on
 * every bump.
 */
export function listenToCampaignChannelMembers(
  campaignId: string,
  dataHandler: {
    onMembers: (members: ChannelMemberRow[]) => void;
    onLoaded: () => void;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe {
  const { onMembers, onLoaded } = dataHandler;
  if (!campaignId) {
    onError(new Error("Must open a campaign to load its channel roster."));
    return () => {};
  }
  const client = getSupabaseClient();
  let loaded = false;

  return listenToRows<ChannelMemberRow>({
    client,
    channelName: constructCampaignChannelMembersChannelName(campaignId),
    bindings: [
      {
        type: "postgres_changes",
        table: CHAT_CHANNELS_TABLE,
        filter: constructCampaignChannelsFilter(campaignId),
        toChange: () => ({ kind: "refresh" }),
      },
    ],
    fetchRows: async () => {
      // The join carries the campaign filter the roster table itself lacks;
      // the channel access rules on the joined table quietly drop every
      // channel the reader may not see, DMs first.
      const { data, error } = await client
        .from(CHAT_CHANNEL_MEMBERS_TABLE)
        .select("channel_id, user_id, created_at, chat_channels!inner(campaign_id)")
        .eq("chat_channels.campaign_id", campaignId);
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as Array<
        ChannelMemberRow & { chat_channels?: unknown }
      >;
      return rows.map(({ channel_id, user_id, created_at }) => ({
        channel_id,
        user_id,
        created_at,
      }));
    },
    getKey: (row) => `${row.channel_id}:${row.user_id}`,
    onRows: (rows) => {
      onMembers(rows);
      if (!loaded) {
        loaded = true;
        onLoaded();
      }
    },
    onError,
  });
}
