import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { CharacterDocument } from "api-calls/character/_character.type";
import {
  CHARACTERS_TABLE,
  characterPayloadToChange,
  characterRowToDocument,
  type CharacterRow,
} from "../character/_getRef";

interface Params {
  characterIdList: string[];
  onDocChange: (id: string, character?: CharacterDocument) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void;
}

export function listenToCampaignCharacters(params: Params): Unsubscribe[] {
  const { characterIdList, onDocChange, onError } = params;

  return (characterIdList || []).map((characterId) => {
    const client = getSupabaseClient();
    return listenToRows<CharacterRow>({
      client,
      channelName: `character:${characterId}`,
      bindings: [
        {
          type: "postgres_changes",
          table: CHARACTERS_TABLE,
          filter: `id=eq.${characterId}`,
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
        onDocChange(characterId, row ? characterRowToDocument(row) : undefined);
      },
      onError,
    });
  });
}
