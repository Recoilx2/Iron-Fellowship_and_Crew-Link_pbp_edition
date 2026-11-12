import { getSupabaseClient } from "config/supabase.config";
import { Profile } from "./_profile.type";

interface ProfileRow {
  id: string;
  display_name: string;
}

/**
 * Reads the signed-in person's own profile row. Returns null when no row
 * exists yet (the signup trigger normally creates one first).
 */
export async function getProfile(params: {
  uid: string;
}): Promise<Profile | null> {
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("id, display_name")
    .eq("id", params.uid)
    .single();

  if (error) {
    // No row yet: PostgREST reports zero rows as an error.
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "PGRST116") {
        return null;
      }
    }
    console.error(error);
    throw "Failed to load display name.";
  }
  const row = data as unknown as ProfileRow;
  return { id: row.id, displayName: row.display_name };
}
