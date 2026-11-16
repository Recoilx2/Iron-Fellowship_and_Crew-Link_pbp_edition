import { getSupabaseClient } from "config/supabase.config";
import { AppUser, toAppUser } from "./appUser";
import { logError } from "functions/errorReference";

/**
 * The currently signed-in person, or null. Sessions persist in the browser
 * until sign-out, so this resolves from storage without a round trip when
 * the session is still valid.
 */
export async function getUser(): Promise<AppUser | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) {
    logError("getUser", error);
    return null;
  }
  const user = data.session?.user;
  return user ? toAppUser(user) : null;
}
