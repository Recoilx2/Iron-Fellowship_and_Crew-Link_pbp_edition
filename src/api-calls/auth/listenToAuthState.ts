import { Unsubscribe } from "api-calls/helpers.type";
import { getSupabaseClient } from "config/supabase.config";
import { AppUser, toAppUser } from "./appUser";

/**
 * Data-layer auth-state listener. Converts the Supabase user to the
 * app-owned `AppUser` at the edge and returns a plain unsubscribe function.
 */
export function listenToAuthState(params: {
  onUser: (user: AppUser | null) => void;
  onError?: (error: unknown) => void;
}): Unsubscribe {
  const {
    data: { subscription },
  } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
    try {
      params.onUser(session?.user ? toAppUser(session.user) : null);
    } catch (error) {
      params.onError?.(error);
    }
  });
  return () => subscription.unsubscribe();
}
