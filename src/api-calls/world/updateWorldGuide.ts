import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Adds or removes a world guide (an extra owner). Only existing world GMs
 * manage the list; the database enforces it, and refuses to remove the
 * last owner. Campaign GMs need no guide entry: they manage linked worlds
 * through the access rules (decision #12).
 */
export const updateWorldGuide = createApiFunction<
  {
    worldId: string;
    guideId: string;
    shouldRemove?: boolean;
  },
  void
>(async (params) => {
  const { worldId, guideId, shouldRemove } = params;
  const { error } = await getSupabaseClient().rpc(
    shouldRemove ? "remove_world_guide" : "add_world_guide",
    { wid: worldId, guide_id: guideId }
  );
  if (error) {
    throw error;
  }
}, "Failed to update world guides.");
