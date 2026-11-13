import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { World } from "api-calls/world/_world.type";
import { WORLDS_TABLE, worldUpdateToColumns } from "./_getRef";

/**
 * Edits the world row: name, setting and truths. Only the world's
 * GMs (owners and campaign GMs) may write; the database enforces it. The
 * description has its own function because it is a Yjs document on the
 * note server; ownership changes go through the owners-only
 * add/remove_world_guide RPCs and are rejected here so a caller can never
 * smuggle them past the mapping.
 */
export const updateWorld = createApiFunction<
  { worldId: string; partialWorld: Partial<World> },
  void
>(async (params) => {
  const { worldId, partialWorld } = params;
  if (partialWorld.ownerIds !== undefined) {
    throw new Error(
      "World ownership changes only through add/remove_world_guide."
    );
  }
  const columns = worldUpdateToColumns(partialWorld);
  if (Object.keys(columns).length === 0) {
    return;
  }
  const { error } = await getSupabaseClient()
    .from(WORLDS_TABLE)
    .update(columns)
    .eq("id", worldId);
  if (error) {
    throw error;
  }
}, "Failed to update world.");
