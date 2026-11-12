import { createApiFunction } from "api-calls/createApiFunction";
import {
  ClientOption,
  resolveClient,
} from "api-calls/homebrew/_supabase";

/**
 * Removes an editor from a collection. Only a current editor can remove
 * anyone, so non-editors cannot manage the roster; omitting `uid` removes
 * the caller. Replaces the old invite-key cloud function.
 */
export const removeHomebrewEditor = createApiFunction<
  { id: string; uid?: string } & ClientOption,
  boolean
>(async (params) => {
  const { data, error } = await resolveClient({ client: params.client }).rpc(
    "homebrew_remove_editor",
    {
      p_collection_id: params.id,
      p_user_id: params.uid ?? null,
    }
  );
  if (error) throw error;
  return (data as boolean | null) ?? false;
}, "Failed to remove editor.");
