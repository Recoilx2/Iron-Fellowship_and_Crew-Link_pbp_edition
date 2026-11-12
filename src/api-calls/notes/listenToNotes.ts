import {
  DocumentData,
  onSnapshot,
  query,
  QuerySnapshot,
  where,
} from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import {
  getCampaignNoteCollection,
  CHARACTER_NOTES_TABLE,
  characterNotePayloadToChange,
  constructCharacterNotesChannelName,
  constructCharacterNotesFilter,
  type CharacterNoteRow,
} from "./_getRef";
import { Note } from "types/Notes.type";
import { NoteSource } from "stores/notes/notes.slice.type";
import { NoteDocument } from "./_notes.type";

function handleFirebaseSnapshot(
  source: NoteSource,
  snapshot: QuerySnapshot<NoteDocument, DocumentData>,
  onNotes: (source: NoteSource, notes: Note[]) => void
) {
  const notes: Note[] = snapshot.docs
    .map((doc) => {
      const noteDoc = doc.data();

      return {
        noteId: doc.id,
        ...noteDoc,
        shared: noteDoc.shared ?? false,
      };
    })
    .sort((n1, n2) => n1.order - n2.order);

  onNotes(source, notes);
}

export function listenToNotes(
  campaignId: string | undefined,
  characterId: string | undefined,
  onlySharedCampaignNotes: boolean,
  onNotes: (source: NoteSource, notes: Note[]) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): PlainUnsubscribe {
  if (!campaignId && !characterId) {
    onError("Either character or campaign ID must be defined.");
    return () => {};
  }

  const unsubscribes: PlainUnsubscribe[] = [];

  // Campaign notes stay on Firebase until the notes ticket ports them.
  if (campaignId) {
    unsubscribes.push(
      onSnapshot(
        onlySharedCampaignNotes
          ? query(
              getCampaignNoteCollection(campaignId),
              where("shared", "==", true)
            )
          : getCampaignNoteCollection(campaignId),
        (snapshot) =>
          handleFirebaseSnapshot(NoteSource.Campaign, snapshot, onNotes),
        onError
      )
    );
  }

  if (characterId) {
    const client = getSupabaseClient();
    unsubscribes.push(
      listenToRows<CharacterNoteRow>({
        client,
        channelName: constructCharacterNotesChannelName(characterId),
        bindings: [
          {
            type: "postgres_changes",
            table: CHARACTER_NOTES_TABLE,
            filter: constructCharacterNotesFilter(characterId),
            toChange: characterNotePayloadToChange,
          },
        ],
        fetchRows: async () => {
          const { data, error } = await client
            .from(CHARACTER_NOTES_TABLE)
            .select("*")
            .eq("character_id", characterId);
          if (error) {
            throw error;
          }
          return (data ?? []) as unknown as CharacterNoteRow[];
        },
        getKey: (row) => row.id,
        getUpdatedAt: (row) => row.updated_at,
        onRows: (rows) => {
          onNotes(
            NoteSource.Character,
            rows
              .map((row) => ({
                noteId: row.id,
                title: row.title,
                order: row.sort_order,
                shared: row.shared,
              }))
              .sort((n1, n2) => n1.order - n2.order)
          );
        },
        onError,
      })
    );
  }

  return () => {
    unsubscribes.forEach((unsubscribe) => {
      unsubscribe();
    });
  };
}
