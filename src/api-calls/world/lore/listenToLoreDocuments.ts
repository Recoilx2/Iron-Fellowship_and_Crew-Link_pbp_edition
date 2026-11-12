import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { Lore } from "types/Lore.type";
import { getWorldImageUrl } from "api-calls/world/worldImageStorage";
import {
  WORLD_LORE_TABLE,
  constructWorldLoreChannelName,
  constructWorldLoreFilter,
  lorePayloadToChange,
  loreRowToDocument,
  type LoreRow,
} from "./_getRef";

/**
 * Follows every lore document in a world one person may see. The database
 * filters the rows: world GMs receive all documents, other viewers only
 * the shared ones, outsiders none. Image URLs resolve lazily per row.
 */
export function listenToLoreDocuments(
  worldId: string,
  updateLore: (loreId: string, lore: Lore) => void,
  updateLoreImage: (loreId: string, imageUrl: string) => void,
  removeLore: (loreId: string) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  const client = getSupabaseClient();
  let previousIds = new Set<string>();

  return listenToRows<LoreRow>({
    client,
    channelName: constructWorldLoreChannelName(worldId),
    bindings: [
      {
        type: "postgres_changes",
        table: WORLD_LORE_TABLE,
        filter: constructWorldLoreFilter(worldId),
        toChange: lorePayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(WORLD_LORE_TABLE)
        .select("*")
        .eq("world_id", worldId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as LoreRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const seen = new Set<string>();
      for (const row of rows) {
        seen.add(row.id);
        updateLore(row.id, loreRowToDocument(row));
        if (
          Array.isArray(row.image_filenames) &&
          row.image_filenames.length > 0
        ) {
          getWorldImageUrl(worldId, row.id, row.image_filenames[0])
            .then((url) => updateLoreImage(row.id, url))
            .catch(() => {});
        }
      }
      for (const id of previousIds) {
        if (!seen.has(id)) {
          removeLore(id);
        }
      }
      previousIds = seen;
    },
    onError,
  });
}
