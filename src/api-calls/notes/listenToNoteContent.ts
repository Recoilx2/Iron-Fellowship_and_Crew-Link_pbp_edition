import { onSnapshot, Unsubscribe } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import {
  getCampaignNoteContentDocument,
  CHARACTER_NOTE_CONTENTS_TABLE,
  characterNoteContentPayloadToChange,
  constructCharacterNoteContentChannelName,
  constructCharacterNoteContentFilter,
  type CharacterNoteContentRow,
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
  // Campaign notes stay on Firebase until the notes ticket ports them.
  if (!characterId) {
    const firebaseUnsubscribe: Unsubscribe = onSnapshot(
      getCampaignNoteContentDocument(campaignId as string, noteId),
      (snapshot) => {
        const data = snapshot.data();
        if (data?.notes) {
          onContent(
            (
              data.notes as unknown as { toUint8Array(): Uint8Array }
            ).toUint8Array()
          );
        } else {
          onContent(undefined);
        }
      },
      (error) => onError(error)
    );
    return firebaseUnsubscribe;
  }
  const client = getSupabaseClient();
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
    onRows: (rows) => {
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
    },
    onError,
  });
}
