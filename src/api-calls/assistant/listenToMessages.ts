import { getSupabaseClient } from "config/supabase.config";
import type { Unsubscribe } from "api-calls/helpers.type";
import {
  broadcastRowsBinding,
  listenToRowsDeferred,
} from "api-calls/realtime/listenToRows";
import {
  campaignGmTopic,
  campaignIdsForConversation,
} from "api-calls/realtime/sharedTopics";
import type { AssistantMessageWithId } from "./_assistant.type";
import {
  ASSISTANT_MESSAGES_TABLE,
  constructAssistantMessagesChannelName,
  messageRowToDocument,
  type AssistantMessageRow,
} from "./_getRef";

/**
 * Follows one conversation's messages oldest first. The access rules decide
 * which rows arrive: the owning GM sees their messages, while anyone else
 * sees none. Returns a plain unsubscribe function.
 */
export function listenToMessages(
  conversationId: string,
  dataHandler: {
    onMessages: (messages: AssistantMessageWithId[]) => void;
    onLoaded: () => void;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe {
  const { onMessages, onLoaded } = dataHandler;
  if (!conversationId) {
    onError(new Error("Must open a conversation to load its messages."));
    return () => {};
  }
  const client = getSupabaseClient();
  let loaded = false;

  return listenToRowsDeferred<AssistantMessageRow>(
    async () => ({
      client,
      channelName: constructAssistantMessagesChannelName(conversationId),
      bindings: [
        // Messages are GM-only: the campaign comes from the conversation
        // row, and the trigger publishes on campaign-gm:assistant.
        ...(await campaignIdsForConversation(client, conversationId)).map(
          (campaignId) =>
            broadcastRowsBinding<AssistantMessageRow>({
              topic: campaignGmTopic(campaignId, "assistant"),
              optional: true,
              table: ASSISTANT_MESSAGES_TABLE,
              getKey: (row) => row.id,
            })
        ),
      ],
      fetchRows: async () => {
        const { data, error } = await client
          .from(ASSISTANT_MESSAGES_TABLE)
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true });
        if (error) {
          throw error;
        }
        return (data ?? []) as unknown as AssistantMessageRow[];
      },
      getKey: (row: AssistantMessageRow) => row.id,
      getUpdatedAt: (row: AssistantMessageRow) => row.updated_at,
      onRows: (rows: AssistantMessageRow[]) => {
        onMessages(
          rows.map((row) => ({
            id: row.id,
            conversationId: row.conversation_id,
            ...messageRowToDocument(row),
          }))
        );
        if (!loaded) {
          loaded = true;
          onLoaded();
        }
      },
      onError,
    }),
    onError
  );
}
