import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { Truth } from "api-calls/world/_world.type";
import { WORLDS_TABLE } from "./_getRef";

/**
 * Merges one truth into the world's truths. Only world GMs may write; the
 * database enforces it.
 */
export const updateWorldTruth = createApiFunction<
  { worldId: string; truthKey: string; truth: Truth },
  void
>(async (params) => {
  const { worldId, truthKey, truth } = params;
  const client = getSupabaseClient();
  const { data, error: readError } = await client
    .from(WORLDS_TABLE)
    .select("new_truths")
    .eq("id", worldId)
    .single();
  if (readError || !data) {
    throw readError ?? new Error("Failed to update world truth.");
  }
  const merged = {
    ...((data as { new_truths: Record<string, Truth> }).new_truths ?? {}),
    [truthKey]: truth,
  };
  const { error } = await client
    .from(WORLDS_TABLE)
    .update({ new_truths: merged })
    .eq("id", worldId);
  if (error) {
    throw error;
  }
}, "Failed to update world truth.");
