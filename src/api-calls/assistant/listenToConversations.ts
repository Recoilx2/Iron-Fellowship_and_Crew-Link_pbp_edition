import { getSupabaseClient } from "config/supabase.config";
import type { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import type { AssistantConversationWithId } from "./_assistant.type";
import {
  ASSISTANT_CONVERSATIONS_TABLE,
  assistantConversationPayloadToChange,
  constructAssistantConversationsChannelName,
  constructAssistantConversationsFilter,
  conversationRowToDocument,
  type AssistantConversationRow,
} from "./_getRef";

/**
 * Follows one campaign's assistant conversations. The access rules decide
 * which rows arrive: the owning GM sees their own conversations, while a
 * co-GM, a player or an outsider sees none. Returns a plain unsubscribe
 * function.
 */
export function listenToConversations(
  campaignId: string,
  dataHandler: {
    onConversations: (conversations: AssistantConversationWithId[]) => void;
    onLoaded: () => void;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe {
  const { onConversations, onLoaded } = dataHandler;
  if (!campaignId) {
    onError(new Error("Must open a campaign to load its conversations."));
    return () => {};
  }
  const client = getSupabaseClient();
  let loaded = false;

  return listenToRows<AssistantConversationRow>({
    client,
    channelName: constructAssistantConversationsChannelName(campaignId),
    bindings: [
      {
        type: "postgres_changes",
        table: ASSISTANT_CONVERSATIONS_TABLE,
        filter: constructAssistantConversationsFilter(campaignId),
        toChange: assistantConversationPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(ASSISTANT_CONVERSATIONS_TABLE)
        .select("*")
        .eq("campaign_id", campaignId)
        .order("updated_at", { ascending: false });
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as AssistantConversationRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      onConversations(
        rows.map((row) => ({
          id: row.id,
          campaignId: row.campaign_id,
          ownerId: row.owner_id,
          ...conversationRowToDocument(row),
        }))
      );
      if (!loaded) {
        loaded = true;
        onLoaded();
      }
    },
    onError,
  });
}
