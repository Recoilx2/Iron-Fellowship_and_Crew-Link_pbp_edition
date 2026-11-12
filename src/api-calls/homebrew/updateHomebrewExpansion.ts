import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewCollectionDocument } from "api-calls/homebrew/_homebrewCollection.type";
import {
  ClientOption,
  resolveClient,
} from "api-calls/homebrew/_supabase";

/**
 * Updates a collection's title or description. Editorship and viewership
 * change only through the invite and viewer functions, so anything else on
 * the update is ignored.
 */
export const updateHomebrewExpansion = createApiFunction<
  { id: string; expansion: DocumentUpdate<HomebrewCollectionDocument> } & ClientOption,
  void
>(async (params) => {
  const { id, expansion } = params;
  const patch: { title?: string; description?: string } = {};
  if (typeof expansion.title === "string") {
    patch.title = expansion.title;
  }
  if (typeof expansion.description === "string") {
    patch.description = expansion.description;
  }
  if (Object.keys(patch).length === 0) {
    return;
  }
  const client = resolveClient({ client: params.client });
  const { error } = await client
    .from("homebrew_collections")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}, "Failed to update expansion.");
