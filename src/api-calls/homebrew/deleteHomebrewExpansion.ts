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
  // Only the creator can delete: anyone else's DELETE matches zero rows and
  // succeeds with an empty payload, so reject when nothing was written.
  const { data, error } = await client
    .from("homebrew_collections")
    .delete()
    .eq("id", params.id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`homebrew collection ${params.id} was not deleted`);
  }
}, "Failed to delete expansion.");
