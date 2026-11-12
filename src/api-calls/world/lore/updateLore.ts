import { getSupabaseClient } from "config/supabase.config";
import { Lore } from "types/Lore.type";
import { createApiFunction } from "api-calls/createApiFunction";
import {
  WORLD_LORE_TABLE,
  loreUpdateToColumns,
  type LoreRow,
} from "./_getRef";

interface LoreParams {
  worldId: string;
  loreId: string;
  lore: Partial<Lore>;
}

/**
 * Edits a lore document. Only world GMs may write; the database enforces
 * it. Dotted field paths merge over the current row so sibling data is
 * never lost.
 */
export const updateLore = createApiFunction<LoreParams, void>(
  async (params) => {
    const { worldId, loreId, lore } = params;
    const client = getSupabaseClient();
    const { data, error: readError } = await client
      .from(WORLD_LORE_TABLE)
      .select("*")
      .eq("id", loreId)
      .eq("world_id", worldId)
      .single();
    if (readError || !data) {
      throw readError ?? new Error("Failed to update lore document.");
    }
    const columns = loreUpdateToColumns(data as unknown as LoreRow, lore);
    if (Object.keys(columns).length === 0) {
      return;
    }
    const { error } = await client
      .from(WORLD_LORE_TABLE)
      .update(columns)
      .eq("id", loreId);
    if (error) {
      throw error;
    }
  },
  "Failed to update lore document."
);
