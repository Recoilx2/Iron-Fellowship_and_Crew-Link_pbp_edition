import { getSupabaseClient } from "config/supabase.config";
import type { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import type { ChannelDocument } from "api-calls/chat/_chat.type";
import {
  CHAT_CHANNELS_TABLE,
  channelPayloadToChange,
  channelRowToDocument,
  constructCampaignChannelsChannelName,
  constructCampaignChannelsFilter,
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

  return listenToRows<ChannelRow>({
    client,
    channelName: constructCampaignChannelsChannelName(campaignId),
    bindings: [
      {
        type: "postgres_changes",
        table: CHAT_CHANNELS_TABLE,
        filter: constructCampaignChannelsFilter(campaignId),
        toChange: channelPayloadToChange,
      },
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
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      onChannels(
        rows.map((row) => ({ id: row.id, ...channelRowToDocument(row) }))
      );
      if (!loaded) {
        loaded = true;
        onLoaded();
      }
    },
    onError,
  });
}
