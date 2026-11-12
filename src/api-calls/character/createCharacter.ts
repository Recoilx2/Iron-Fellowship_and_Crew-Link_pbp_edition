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
  const { uid, name, stats, assets, expansionIds } = params;
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(CHARACTERS_TABLE)
    .insert({
      owner_id: uid,
      name,
      stats,
      ...(expansionIds ? { expansion_ids: expansionIds } : {}),
    })
    .select("id")
    .single();
  if (error || !data) {
    throw error ?? new Error("Failed to create your character");
  }
  const id = (data as { id: string }).id;

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
