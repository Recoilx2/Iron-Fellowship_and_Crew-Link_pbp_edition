import {
  ClientOption,
  resolveClient,
} from "api-calls/homebrew/_supabase";

/**
 * Accepts an editor invite: adds the caller as an editor and spends the key,
 * so the key cannot be reused. Returns false when the key is unknown, spent,
 * or meant for another collection. Replaces the old invite-key cloud
 * function.
 */
export function acceptEditorInvite(
  homebrewCollectionId: string,
  inviteKey: string,
  opts?: ClientOption
): Promise<boolean> {
  return (async () => {
    const { data, error } = await resolveClient(opts).rpc(
      "homebrew_accept_invite",
      {
        p_collection_id: homebrewCollectionId,
        p_key: inviteKey,
      }
    );
    if (error) {
      console.error(error);
      throw error;
    }
    return (data as boolean | null) ?? false;
  })();
}
