import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import {
  broadcastRowsBinding,
  listenToRowsDeferred,
} from "api-calls/realtime/listenToRows";
import {
  campaignBroadcastBindings,
  visibleCampaignIds,
} from "api-calls/realtime/sharedTopics";
import { World } from "api-calls/world/_world.type";
import {
  WORLDS_TABLE,
  constructUserWorldsChannelName,
  worldRowToDocument,
  type WorldRow,
} from "./_getRef";

/**
 * Follows every world one person may see: worlds they own and worlds used
 * by their campaigns. The database filters the rows, so removed worlds and
 * unlinked worlds drop through onDocRemove at once.
 */
export function listenToUsersWorlds(
  uid: string | undefined,
  dataHandler: {
    onDocChange: (id: string, data: World) => void;
    onDocRemove: (id: string) => void;
    onLoaded: () => void;
  },
  onError: (error: unknown) => void
): Unsubscribe | undefined {
  if (!uid) {
    return undefined;
  }
  const client = getSupabaseClient();
  let previousIds = new Set<string>();
  return listenToRowsDeferred<WorldRow>(
    async () => {
      const campaignIds = await visibleCampaignIds(client);
      return {
        client,
        channelName: constructUserWorldsChannelName(uid),
        bindings: [
          // Dual bindings while the world area is being flipped.
          ...campaignIds.flatMap((campaignId) =>
            campaignBroadcastBindings<WorldRow>(campaignId, "world", () =>
              broadcastRowsBinding<WorldRow>({
                table: WORLDS_TABLE,
                getKey: (row) => row.id,
              })
            )
          ),
        ],
        fetchRows: async () => {
          const { data, error } = await client.from(WORLDS_TABLE).select("*");
          if (error) {
            throw error;
          }
          return (data ?? []) as unknown as WorldRow[];
        },
        getKey: (row: WorldRow) => row.id,
        getUpdatedAt: (row: WorldRow) => row.updated_at,
        onRows: (rows: WorldRow[]) => {
          const seen = new Set(rows.map((row) => row.id));
          for (const row of rows) {
            dataHandler.onDocChange(row.id, worldRowToDocument(row));
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
      };
    },
    onError
  );
}
