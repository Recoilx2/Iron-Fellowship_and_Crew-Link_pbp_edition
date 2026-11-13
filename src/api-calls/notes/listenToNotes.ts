import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import {
  CHARACTER_NOTES_TABLE,
  CAMPAIGN_NOTES_TABLE,
  characterNotePayloadToChange,
  campaignNotePayloadToChange,
  constructCharacterNotesChannelName,
  constructCharacterNotesFilter,
  constructCampaignNotesChannelName,
  constructCampaignNotesFilter,
  type CharacterNoteRow,
  type CampaignNoteRow,
} from "./_getRef";
import { Note } from "types/Notes.type";
import { NoteSource } from "stores/notes/notes.slice.type";

export function listenToNotes(
  campaignId: string | undefined,
  characterId: string | undefined,
  onNotes: (source: NoteSource, notes: Note[]) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): PlainUnsubscribe {
  if (!campaignId && !characterId) {
    onError("Either character or campaign ID must be defined.");
    return () => {};
  }

  const unsubscribes: PlainUnsubscribe[] = [];

  // Row-level security hides unshared notes from everyone except the people
  // allowed to see them, so no client-side shared filter is needed.
  if (campaignId) {
    const client = getSupabaseClient();
    unsubscribes.push(
      listenToRows<CampaignNoteRow>({
        client,
        channelName: constructCampaignNotesChannelName(campaignId),
        bindings: [
          {
            type: "postgres_changes",
            table: CAMPAIGN_NOTES_TABLE,
            filter: constructCampaignNotesFilter(campaignId),
            toChange: campaignNotePayloadToChange,
          },
        ],
        fetchRows: async () => {
          const { data, error } = await client
            .from(CAMPAIGN_NOTES_TABLE)
            .select("*")
            .eq("campaign_id", campaignId);
          if (error) {
            throw error;
          }
          return (data ?? []) as unknown as CampaignNoteRow[];
        },
        getKey: (row) => row.id,
        getUpdatedAt: (row) => row.updated_at,
        onRows: (rows) => {
          onNotes(
            NoteSource.Campaign,
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
