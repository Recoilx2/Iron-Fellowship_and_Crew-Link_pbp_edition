import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import {
  broadcastRowsBinding,
  listenToRowsDeferred,
} from "api-calls/realtime/listenToRows";
import {
  campaignBroadcastBindings,
  campaignIdsForWorld,
} from "api-calls/realtime/sharedTopics";
import { World } from "api-calls/world/_world.type";
import {
  WORLDS_TABLE,
  constructWorldChannelName,
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
  return listenToRowsDeferred<WorldRow>(
    async () => ({
      client,
      channelName: constructWorldChannelName(worldId),
      bindings: [
        ...(await campaignIdsForWorld(client, worldId)).flatMap((campaignId) =>
          campaignBroadcastBindings<WorldRow>(campaignId, "world", () =>
            broadcastRowsBinding<WorldRow>({
              table: WORLDS_TABLE,
              getKey: (row) => row.id,
            })
          )
        ),
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
      getKey: (row: WorldRow) => row.id,
      getUpdatedAt: (row: WorldRow) => row.updated_at,
      onRows: (rows: WorldRow[]) => {
        const row = rows.find((candidate) => candidate.id === worldId);
        onDocChange(row ? worldRowToDocument(row) : undefined);
        loaded = true;
      },
      onError: (error: unknown) => {
        if (!loaded) {
          onDocChange(undefined);
        }
        onError(error);
      },
    }),
    onError
  );
}
