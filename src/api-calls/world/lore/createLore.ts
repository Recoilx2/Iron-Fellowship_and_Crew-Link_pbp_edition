import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { ensureWorldItemNotes } from "api-calls/world/worldNotes";
import { WORLD_LORE_TABLE } from "./_getRef";

/**
 * Creates a blank lore document, shared with players by default. Note rows
 * for its public and GM-only notes are created with it, so the note
 * server finds them on first connect.
 */
export const createLore = createApiFunction<
  { worldId: string; shared?: boolean },
  string
>(async (params) => {
  const { worldId } = params;
  const { data, error } = await getSupabaseClient()
    .from(WORLD_LORE_TABLE)
    .insert({
      world_id: worldId,
      name: "New Lore Document",
      shared_with_players: true,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw error ?? new Error("Failed to create a new lore document.");
  }
  const id = (data as { id: string }).id;
  await ensureWorldItemNotes(worldId, "lore", id);
  return id;
}, "Failed to create a new lore document.");
