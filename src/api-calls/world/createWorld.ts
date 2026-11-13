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
  // The id is generated here so the insert needs no RETURNING clause: the
  // worlds SELECT policy re-queries its own table, which cannot see a
  // just-inserted row in the same statement, so insert-then-select always
  // fails RLS (#74). The plain INSERT policy compares owner_ids directly
  // and accepts the row.
  const id = crypto.randomUUID();
  const { error } = await client.from(WORLDS_TABLE).insert({
    id,
    name: params.name ?? "New World",
    setting_key: params.settingKey ?? "ironlands",
    owner_ids: [uid],
  });
  if (error) {
    throw error;
  }
  return id;
}, "Failed to create world");
