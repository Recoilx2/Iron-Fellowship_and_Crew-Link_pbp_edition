import { removeHomebrewEditor } from "api-calls/homebrew/removeHomebrewEditor";
import { ClientOption } from "api-calls/homebrew/_supabase";

/**
 * Gives up the caller's own editorship. Replaces the old invite-key cloud
 * function; removing anyone else goes through removeHomebrewEditor.
 */
export function removeSelfAsEditor(
  homebrewCollectionId: string,
  opts?: ClientOption
): Promise<boolean> {
  return removeHomebrewEditor({ id: homebrewCollectionId, ...opts });
}
