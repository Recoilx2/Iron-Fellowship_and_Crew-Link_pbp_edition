import { getSupabaseClient } from "config/supabase.config";
import { AssetDocument } from "api-calls/assets/_asset.type";
import { StatsMap } from "api-calls/character/_character.type";
import { CHARACTERS_TABLE } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const createCharacter = createApiFunction<
  {
    uid: string;
    name: string;
    stats: StatsMap;
    assets: AssetDocument[];
    expansionIds?: string[];
  },
  string
>(async (params) => {
  const { name, stats, assets, expansionIds } = params;
  const client = getSupabaseClient();

  // Ownership always comes from the signed-in session: the INSERT policy
  // (characters_insert_own) compares owner_id against auth.uid(), so a
  // caller-supplied uid naming anyone else is rejected by the database.
  // params.uid stays for signature compatibility but never decides
  // ownership; createCampaign already works this way (its RPC ignores uid
  // and uses auth.uid()).
  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();
  const ownerId = sessionData.session?.user.id;
  if (sessionError || !ownerId) {
    throw sessionError ?? new Error("You must be logged in to create a character");
  }

  // The id is generated here so the insert needs no RETURNING clause: the
  // characters SELECT policy re-queries its own table, which cannot see a
  // just-inserted row in the same statement, so insert-then-select always
  // fails RLS (#69). The plain INSERT policy compares owner_id directly and
  // accepts the row.
  const id = crypto.randomUUID();
  const { error } = await client.from(CHARACTERS_TABLE).insert({
    id,
    owner_id: ownerId,
    name,
    stats,
    ...(expansionIds ? { expansion_ids: expansionIds } : {}),
  });
  if (error) {
    throw error;
  }

  if (assets.length > 0) {
    const { error: assetsError } = await client
      .from("character_assets")
      .insert(
        assets.map((asset) => ({
          character_id: id,
          datasworn_id: asset.id,
          enabled_abilities: asset.enabledAbilities ?? {},
          option_values: asset.optionValues ?? {},
          control_values: asset.controlValues ?? {},
          sort_order: asset.order,
        }))
      );
    if (assetsError) {
      console.error(assetsError);
    }
  }

  return id;
}, "Failed to create your character");
