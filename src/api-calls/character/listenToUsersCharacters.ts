import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { CharacterDocument } from "api-calls/character/_character.type";
import {
  CHARACTERS_TABLE,
  characterPayloadToChange,
  characterRowToDocument,
  constructCharactersChannelName,
  constructCharactersOwnerFilter,
  type CharacterRow,
} from "./_getRef";

export function listenToUsersCharacters(
  uid: string,
  dataHandler: {
    onDocChange: (id: string, data: CharacterDocument) => void;
    onDocRemove: (id: string) => void;
    onLoaded: () => void;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe | undefined {
  if (!uid) {
    return;
  }
  const client = getSupabaseClient();
  let previousIds = new Set<string>();
  return listenToRows<CharacterRow>({
    client,
    channelName: constructCharactersChannelName(uid),
    bindings: [
      {
        type: "postgres_changes",
        table: CHARACTERS_TABLE,
        filter: constructCharactersOwnerFilter(uid),
        toChange: characterPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(CHARACTERS_TABLE)
        .select("*")
        .eq("owner_id", uid);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CharacterRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const seen = new Set(rows.map((row) => row.id));
      for (const row of rows) {
        dataHandler.onDocChange(row.id, characterRowToDocument(row));
      }
      for (const id of previousIds) {
        if (!seen.has(id)) {
          dataHandler.onDocRemove(id);
        }
      }
      previousIds = seen;
      dataHandler.onLoaded();
    },
    onError,
  });
}
