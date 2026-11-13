import {
  ClientOption,
  resolveClient,
} from "api-calls/homebrew/_supabase";
import { constructHomebrewEditorInvitePath } from "pages/Homebrew/routes";

/**
 * Mints an editor invite link for a collection. Only editors can mint;
 * anyone else gets a rejection. Replaces the old invite-key cloud function.
 */
export function getEditorInviteUrl(
  homebrewCollectionId: string,
  opts?: ClientOption
): Promise<string | null> {
  return (async () => {
    const { data, error } = await resolveClient(opts).rpc(
      "homebrew_create_invite_key",
      { p_collection_id: homebrewCollectionId }
    );
    if (error || !data) {
      console.error(error ?? "No invite key was returned");
      throw new Error("No invite key was returned");
    }
    return constructHomebrewEditorInvitePath(data as string);
  })();
}
