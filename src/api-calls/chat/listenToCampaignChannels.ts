import { getSupabaseClient } from "config/supabase.config";
import type { Unsubscribe } from "api-calls/helpers.type";
import {
  broadcastRefreshBinding,
  broadcastRowsBinding,
  listenToRowsDeferred,
} from "api-calls/realtime/listenToRows";
import {
  campaignSharedTopic,
  channelIdsForCampaign,
  channelSharedTopic,
} from "api-calls/realtime/sharedTopics";
import type { ChannelDocument } from "api-calls/chat/_chat.type";
import {
  CHAT_CHANNELS_TABLE,
  channelRowToDocument,
  constructCampaignChannelsChannelName,
  type ChannelRow,
} from "./_getRef";

export interface ChannelWithId extends ChannelDocument {
  id: string;
}

/**
 * Follows every channel of one campaign. Members see all channels; outsiders
 * see none, because the channel access rules (not an interface filter) decide
 * which rows arrive. Returns a plain unsubscribe function.
 */
export function listenToCampaignChannels(
  campaignId: string,
  dataHandler: {
    onChannels: (channels: ChannelWithId[]) => void;
    onLoaded: () => void;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe {
  const { onChannels, onLoaded } = dataHandler;
  if (!campaignId) {
    onError(new Error("Must open a campaign to load its channels."));
    return () => {};
  }
  const client = getSupabaseClient();
  let loaded = false;

  return listenToRowsDeferred<ChannelRow>(
    async () => {
      const channelIds = await channelIdsForCampaign(client, campaignId);
      return {
        client,
        channelName: constructCampaignChannelsChannelName(campaignId),
        bindings: [
          // Channel rows stream on their own per-channel topic; a new
          // channel is picked up by the reconcile fetch until the topics
          // are rebuilt on the next listener mount.
          ...channelIds.map((id) =>
            broadcastRowsBinding<ChannelRow>({
              topic: channelSharedTopic(id),
              table: CHAT_CHANNELS_TABLE,
              getKey: (row) => row.id,
            })
          ),
          // Membership loss publishes a refresh on the campaign topic, so
          // a removed member's list empties without waiting for the tick.
          broadcastRefreshBinding({
            topic: campaignSharedTopic(campaignId, "chat"),
          }),
        ],
        fetchRows: async () => {
          const { data, error } = await client
            .from(CHAT_CHANNELS_TABLE)
            .select("*")
            .eq("campaign_id", campaignId);
          if (error) {
            throw error;
          }
          return (data ?? []) as unknown as ChannelRow[];
        },
        getKey: (row: ChannelRow) => row.id,
        getUpdatedAt: (row: ChannelRow) => row.updated_at,
        onRows: (rows: ChannelRow[]) => {
          onChannels(
            rows.map((row) => ({ id: row.id, ...channelRowToDocument(row) }))
          );
          if (!loaded) {
            loaded = true;
            onLoaded();
          }
        },
        onError,
      };
    },
    onError
  );
}
