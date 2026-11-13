import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { CharacterDocument } from "api-calls/character/_character.type";
import {
  CHARACTERS_TABLE,
  characterPayloadToChange,
  characterRowToDocument,
  constructCharacterChannelName,
  constructCharacterIdFilter,
  type CharacterRow,
} from "./_getRef";

export function listenToCharacter(
  characterId: string,
  onCharacter: (character: CharacterDocument) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  const client = getSupabaseClient();
  return listenToRows<CharacterRow>({
    client,
    channelName: constructCharacterChannelName(characterId),
    bindings: [
      {
        type: "postgres_changes",
        table: CHARACTERS_TABLE,
        filter: constructCharacterIdFilter(characterId),
        toChange: characterPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(CHARACTERS_TABLE)
        .select("*")
        .eq("id", characterId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CharacterRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const row = rows[0];
      if (row) {
        onCharacter(characterRowToDocument(row));
      } else {
        onError("No character found");
      }
    },
    onError,
  });
}
