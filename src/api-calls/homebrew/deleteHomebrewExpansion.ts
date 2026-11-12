import { createApiFunction } from "api-calls/createApiFunction";
import {
  ClientOption,
  resolveClient,
} from "api-calls/homebrew/_supabase";

/**
 * Deletes a collection and everything under it. Only the creator can delete;
 * the access rules reject everyone else.
 *
 * The old implementation also detached the collection from characters and
 * campaigns, but those tables do not exist yet: detaching belongs to the
 * character and campaign tickets, which own those references.
 */
export const deleteHomebrewExpansion = createApiFunction<
  { id: string } & ClientOption,
  void
>(async (params) => {
  const client = resolveClient({ client: params.client });
  const { error } = await client
    .from("homebrew_collections")
    .delete()
    .eq("id", params.id);
  if (error) throw error;
}, "Failed to delete expansion.");
