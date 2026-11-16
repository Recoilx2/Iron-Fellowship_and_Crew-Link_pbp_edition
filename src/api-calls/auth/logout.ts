import { getSupabaseClient } from "config/supabase.config";
import { logError } from "functions/errorReference";

/**
 * Signs out, ending the persisted session on this device.
 */
export async function logout(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) {
    logError("logout", error);
    throw new Error("Failed to sign out.");
  }
}
