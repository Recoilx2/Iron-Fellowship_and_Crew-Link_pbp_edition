import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { USER_SETTINGS_TABLE } from "./_getRef";

/**
 * Pins or unpins a single oracle section. Oracle ids are stored as plain
 * JSON keys: unlike the Firestore map they replaced, Postgres jsonb accepts
 * any string, so no id encoding is needed at the edge.
 */
export const updatePinnedOracle = createApiFunction<
  { uid: string; oracleId: string; pinned: boolean },
  void
>(async (params) => {
  const { uid, oracleId, pinned } = params;
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(USER_SETTINGS_TABLE)
    .select("pinned_oracle_sections")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const current =
    (data?.pinned_oracle_sections as Record<string, boolean> | null) ?? {};
  const { error: upsertError } = await client
    .from(USER_SETTINGS_TABLE)
    .upsert(
      {
        user_id: uid,
        pinned_oracle_sections: { ...current, [oracleId]: pinned },
      },
      { onConflict: "user_id" }
    );

  if (upsertError) {
    throw upsertError;
  }
}, "Failed to pin oracle.");
