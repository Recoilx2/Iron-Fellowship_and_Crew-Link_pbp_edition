import {
  ClientOption,
  resolveClient,
} from "api-calls/homebrew/_supabase";

/**
 * Looks up the collection behind an editor invite key. Anyone signed in can
 * look up a key they hold; unknown or spent keys resolve to null. Replaces
 * the old invite-key cloud function.
 */
export function getHomebrewCollectionFromInviteUrl(
  inviteKey: string,
  opts?: ClientOption
): Promise<string | null> {
  return (async () => {
    const { data, error } = await resolveClient(opts).rpc(
      "homebrew_collection_id_from_key",
      { p_key: inviteKey }
    );
    if (error) {
      console.error(error);
      throw error;
    }
    return (data as string | null) ?? null;
  })();
}
