import { getSupabaseClient } from "config/supabase.config";
import { upsertProfile } from "api-calls/profiles/upsertProfile";

/**
 * Saves the signed-in person's display name. The `profiles` table is the
 * source of truth; the auth user's metadata is kept in sync so future
 * sessions carry the name.
 */
export function updateUser(params: { displayName: string }): Promise<void> {
  const { displayName } = params;
  return getSupabaseClient()
    .auth.getSession()
    .then(({ data, error }) => {
      const uid = data.session?.user.id;
      if (error || !uid) {
        return Promise.reject("User is not signed in.");
      }
      return getSupabaseClient()
        .auth.updateUser({ data: { display_name: displayName } })
        .then(({ error: metadataError }) => {
          if (metadataError) {
            console.error(metadataError);
            return Promise.reject("Failed to update user name.");
          }
          return upsertProfile({ uid, displayName }).then(() => undefined);
        });
    });
}
