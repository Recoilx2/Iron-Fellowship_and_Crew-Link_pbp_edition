import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { NPC } from "types/NPCs.type";
import { getWorldImageUrl } from "api-calls/world/worldImageStorage";
import {
  WORLD_NPCS_TABLE,
  constructWorldNPCsChannelName,
  constructWorldNPCsFilter,
  npcPayloadToChange,
  npcRowToDocument,
  type NPCRow,
} from "./_getRef";

/**
 * Follows every NPC in a world one person may see. The database filters
 * the rows: world GMs receive all NPCs, other viewers only the shared
 * ones, outsiders none. Image URLs resolve lazily per row.
 */
export function listenToNPCs(
  worldId: string,
  updateNPC: (npcId: string, npc: NPC) => void,
  updateNPCImage: (npcId: string, imageUrl: string) => void,
  removeNPC: (npcId: string) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  const client = getSupabaseClient();
  let previousIds = new Set<string>();

  return listenToRows<NPCRow>({
    client,
    channelName: constructWorldNPCsChannelName(worldId),
    bindings: [
      {
        type: "postgres_changes",
        table: WORLD_NPCS_TABLE,
        filter: constructWorldNPCsFilter(worldId),
        toChange: npcPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(WORLD_NPCS_TABLE)
        .select("*")
        .eq("world_id", worldId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as NPCRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const seen = new Set<string>();
      for (const row of rows) {
        seen.add(row.id);
        updateNPC(row.id, npcRowToDocument(row));
        if (
          Array.isArray(row.image_filenames) &&
          row.image_filenames.length > 0
        ) {
          getWorldImageUrl(worldId, row.id, row.image_filenames[0])
            .then((url) => updateNPCImage(row.id, url))
            .catch(() => {});
        }
      }
      for (const id of previousIds) {
        if (!seen.has(id)) {
          removeNPC(id);
        }
      }
      previousIds = seen;
    },
    onError,
  });
}
