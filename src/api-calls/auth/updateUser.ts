import { getSupabaseClient } from "config/supabase.config";
import { upsertProfile } from "api-calls/profiles/upsertProfile";
import { UserDocument } from "api-calls/user/_user.type";
import { updateUserDoc } from "api-calls/user/updateUserDoc";

/**
 * Saves the signed-in person's display name. The `profiles` table is the
 * source of truth; the auth user's metadata is kept in sync so future
 * sessions carry the name, and the legacy user document keeps a copy until
 * the data-area tickets read names from profiles instead.
 */
export function updateUser(userDoc: UserDocument): Promise<void> {
  const { displayName } = userDoc;
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
          return upsertProfile({ uid, displayName })
            .then(() =>
              // Legacy copy for the Firestore-backed name displays.
              updateUserDoc({ uid, user: userDoc })
            )
            .then(() => undefined);
        });
    });
}
