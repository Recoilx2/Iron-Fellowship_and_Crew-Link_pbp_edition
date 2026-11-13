import { createApiFunction } from "api-calls/createApiFunction";
import { ExpansionDocument } from "api-calls/homebrew/_homebrewCollection.type";
import {
  ClientOption,
  resolveClient,
} from "api-calls/homebrew/_supabase";

const create = createApiFunction<
  { expansion: ExpansionDocument } & ClientOption,
  string
>(async (params) => {
  const { expansion } = params;
  const client = resolveClient({ client: params.client });
  const { data, error } = await client
    .from("homebrew_collections")
    .insert({
      slug: expansion.id,
      title: expansion.title,
      description: expansion.description ?? "",
      creator: expansion.creator,
      ruleset_id: expansion.rulesetId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw error ?? new Error("Failed to create expansion.");
  }
  return (data as unknown as { id: string }).id;
}, "Failed to create expansion.");

/**
 * Creates a collection owned by the caller. The database adds the creator as
 * an editor automatically, so the `editors` field is not sent.
 */
export function createHomebrewExpansion(
  expansion: ExpansionDocument,
  opts?: ClientOption
): Promise<string> {
  return create({ expansion, ...opts });
}
