import { getSupabaseClient } from "config/supabase.config";
import { AppUser, toAppUser } from "./appUser";

/**
 * The currently signed-in person, or null. Sessions persist in the browser
 * until sign-out, so this resolves from storage without a round trip when
 * the session is still valid.
 */
export async function getUser(): Promise<AppUser | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) {
    console.error(error);
    return null;
  }
  const user = data.session?.user;
  return user ? toAppUser(user) : null;
}
