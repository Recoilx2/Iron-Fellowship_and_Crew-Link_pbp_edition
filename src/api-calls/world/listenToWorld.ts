import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { World } from "api-calls/world/_world.type";
import {
  WORLDS_TABLE,
  constructWorldChannelName,
  constructWorldIdFilter,
  worldPayloadToChange,
  worldRowToDocument,
  type WorldRow,
} from "./_getRef";

/**
 * Follows one world row, for campaigns using a world the person does not
 * own. Outsiders receive no rows and see the world as missing; losing
 * access removes it live.
 */
export function listenToWorld(
  worldId: string,
  onDocChange: (data?: World) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  const client = getSupabaseClient();
  let loaded = false;
  return listenToRows<WorldRow>({
    client,
    channelName: constructWorldChannelName(worldId),
    bindings: [
      {
        type: "postgres_changes",
        table: WORLDS_TABLE,
        filter: constructWorldIdFilter(worldId),
        toChange: worldPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(WORLDS_TABLE)
        .select("*")
        .eq("id", worldId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as WorldRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const row = rows.find((candidate) => candidate.id === worldId);
      onDocChange(row ? worldRowToDocument(row) : undefined);
      loaded = true;
    },
    onError: (error) => {
      if (!loaded) {
        onDocChange(undefined);
      }
      onError(error);
    },
  });
}
