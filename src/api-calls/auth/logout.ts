import { getSupabaseClient } from "config/supabase.config";

/**
 * Signs out, ending the persisted session on this device.
 */
export async function logout(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) {
    console.error(error);
    throw new Error("Failed to sign out.");
  }
}
