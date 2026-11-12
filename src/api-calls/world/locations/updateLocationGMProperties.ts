import { getSupabaseClient } from "config/supabase.config";
import { GMLocation } from "types/Locations.type";
import { createApiFunction } from "api-calls/createApiFunction";
import { WORLD_LOCATION_GM_DETAILS_TABLE } from "./_getRef";

interface Params {
  worldId: string;
  locationId: string;
  locationGMProperties: Partial<GMLocation>;
}

/**
 * Saves the structured GM-only fields of a location (descriptor, trouble
 * and the like). GM notes travel through the GM-only world note instead.
 * Only world GMs may write; the database enforces it.
 */
export const updateLocationGMProperties = createApiFunction<Params, void>(
  async (params) => {
    const { locationId, locationGMProperties } = params;
    const client = getSupabaseClient();
    const { data, error: readError } = await client
      .from(WORLD_LOCATION_GM_DETAILS_TABLE)
      .select("*")
      .eq("location_id", locationId)
      .maybeSingle();
    if (readError) {
      throw readError;
    }
    const current = (data ?? {}) as {
      fields?: Record<string, string> | null;
      descriptor?: string | null;
      trouble?: string | null;
      location_features?: string | null;
    };
    const { error } = await client
      .from(WORLD_LOCATION_GM_DETAILS_TABLE)
      .upsert({
        location_id: locationId,
        fields: locationGMProperties.fields ?? current.fields ?? null,
        descriptor:
          locationGMProperties.descriptor ?? current.descriptor ?? null,
        trouble: locationGMProperties.trouble ?? current.trouble ?? null,
        location_features:
          locationGMProperties.locationFeatures ??
          current.location_features ??
          null,
      });
    if (error) {
      throw error;
    }
  },
  "Failed to update location."
);
