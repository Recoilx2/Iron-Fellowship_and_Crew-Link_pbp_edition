import { getSupabaseClient } from "config/supabase.config";
import type { Unsubscribe } from "api-calls/helpers.type";
import {
  broadcastRowsBinding,
  listenToRows,
} from "api-calls/realtime/listenToRows";
import { campaignGmTopic } from "api-calls/realtime/sharedTopics";
import {
  ASSISTANT_OUTLINE_VERSIONS_TABLE,
  constructAssistantOutlineVersionsChannelName,
  outlineVersionRowToDocument,
  type AssistantOutlineVersion,
  type AssistantOutlineVersionRow,
} from "./_getRef";

/**
 * Follows one campaign's kept outline versions, newest first. The access
 * rules decide which rows arrive: the campaign's GMs see every version,
 * while a player or an outsider sees none. The Outline tab uses this to
 * offer Undo only while a version is kept. Returns a plain unsubscribe
 * function.
 */
export function listenToOutlineVersions(
  campaignId: string,
  dataHandler: {
    onVersions: (versions: AssistantOutlineVersion[]) => void;
    onLoaded: () => void;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe {
  const { onVersions, onLoaded } = dataHandler;
  if (!campaignId) {
    onError(new Error("Must open a campaign to load its outline versions."));
    return () => {};
  }
  const client = getSupabaseClient();
  let loaded = false;

  return listenToRows<AssistantOutlineVersionRow>({
    client,
    channelName: constructAssistantOutlineVersionsChannelName(campaignId),
    bindings: [
      broadcastRowsBinding<AssistantOutlineVersionRow>({
        topic: campaignGmTopic(campaignId, "assistant"),
        optional: true,
        table: ASSISTANT_OUTLINE_VERSIONS_TABLE,
        getKey: (row) => row.id,
      }),
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(ASSISTANT_OUTLINE_VERSIONS_TABLE)
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false });
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as AssistantOutlineVersionRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.created_at,
    onRows: (rows) => {
      onVersions(rows.map(outlineVersionRowToDocument));
      if (!loaded) {
        loaded = true;
        onLoaded();
      }
    },
    onError,
  });
}
