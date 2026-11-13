import { getSupabaseClient } from "config/supabase.config";
import { Profile } from "./_profile.type";

/**
 * Writes the person's own display name row. The access rules reject anyone
 * else's row, so this only ever succeeds for the signed-in person.
 */
export async function upsertProfile(params: {
  uid: string;
  displayName: string;
}): Promise<Profile> {
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .upsert(
      { id: params.uid, display_name: params.displayName },
      { onConflict: "id" }
    );

  if (error) {
    console.error(error);
    throw "Failed to save display name.";
  }
  const row = data as unknown as {
    id: string;
    display_name: string;
  } | null;
  // PostgREST upsert without `select()` returns no row; echo the write.
  return {
    id: row?.id ?? params.uid,
    displayName: row?.display_name ?? params.displayName,
  };
}
