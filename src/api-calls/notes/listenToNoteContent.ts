import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import {
  broadcastRefreshBinding,
  listenToRows,
} from "api-calls/realtime/listenToRows";
import { campaignBroadcastBindings } from "api-calls/realtime/sharedTopics";
import {
  CHARACTER_NOTE_CONTENTS_TABLE,
  CAMPAIGN_NOTE_CONTENTS_TABLE,
  characterNoteContentPayloadToChange,
  constructCharacterNoteContentChannelName,
  constructCharacterNoteContentFilter,
  constructCampaignNoteContentChannelName,
  type CharacterNoteContentRow,
  type CampaignNoteContentRow,
} from "./_getRef";
import { decodeNoteContent } from "./noteContent";

export function listenToNoteContent(
  campaignId: string | undefined,
  characterId: string | undefined,
  noteId: string,
  onContent: (content?: Uint8Array) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): PlainUnsubscribe {
  if (!characterId && !campaignId) {
    onError("Either campaign or character ID is required.");
    return () => {};
  }
  const client = getSupabaseClient();
  const onRows = (rows: Array<{ content: string | null }>) => {
    const row = rows[0];
    if (row?.content) {
      try {
        onContent(decodeNoteContent(row.content));
      } catch (error) {
        onError(error);
      }
    } else {
      onContent(undefined);
    }
  };
  if (characterId) {
    return listenToRows<CharacterNoteContentRow>({
      client,
      channelName: constructCharacterNoteContentChannelName(noteId),
      bindings: [
        {
          type: "postgres_changes",
          table: CHARACTER_NOTE_CONTENTS_TABLE,
          filter: constructCharacterNoteContentFilter(noteId),
          toChange: characterNoteContentPayloadToChange,
        },
      ],
      fetchRows: async () => {
        const { data, error } = await client
          .from(CHARACTER_NOTE_CONTENTS_TABLE)
          .select("*")
          .eq("note_id", noteId);
        if (error) {
          throw error;
        }
        return (data ?? []) as unknown as CharacterNoteContentRow[];
      },
      getKey: (row) => row.note_id,
      getUpdatedAt: (row) => row.updated_at,
      onRows,
      onError,
    });
  }
  if (!campaignId) {
    onError("Either campaign or character ID is required.");
    return () => {};
  }
  return listenToRows<CampaignNoteContentRow>({
    client,
    channelName: constructCampaignNoteContentChannelName(noteId),
    bindings: [
      // Yjs bytes are opaque and large: the trigger publishes a refresh
      // signal and this listener reads the content through fetchRows.
      ...campaignBroadcastBindings<CampaignNoteContentRow>(
        campaignId,
        "notes",
        () => broadcastRefreshBinding({ topic: "" })
      ),
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(CAMPAIGN_NOTE_CONTENTS_TABLE)
        .select("*")
        .eq("note_id", noteId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CampaignNoteContentRow[];
    },
    getKey: (row) => row.note_id,
    getUpdatedAt: (row) => row.updated_at,
    onRows,
    onError,
  });
}
