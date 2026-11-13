import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { WORLDS_TABLE } from "./_getRef";

/**
 * Creates a world with the caller as its first owner. Campaign GMs of
 * campaigns linked to the world manage it through the access rules, so no
 * other roster is created here.
 */
export const createWorld = createApiFunction<
  { name?: string; settingKey?: string },
  string
>(async (params) => {
  const client = getSupabaseClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  const uid = userData.user?.id;
  if (userError || !uid) {
    throw userError ?? new Error("Must be signed in to create a world.");
  }
  const { data, error } = await client
    .from(WORLDS_TABLE)
    .insert({
      name: params.name ?? "New World",
      setting_key: params.settingKey ?? "ironlands",
      owner_ids: [uid],
    })
    .select("id")
    .single();
  if (error || !data) {
    throw error ?? new Error("Failed to create world.");
  }
  return (data as { id: string }).id;
}, "Failed to create world");
