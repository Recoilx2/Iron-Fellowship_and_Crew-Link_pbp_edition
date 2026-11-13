import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { GMLocation } from "types/Locations.type";
import {
  WORLD_LOCATION_GM_DETAILS_TABLE,
  constructLocationChannelName,
  constructLocationIdFilter,
  locationGMDetailsPayloadToChange,
  locationGMDetailsRowToDocument,
  type LocationGMDetailsRow,
} from "./_getRef";

/**
 * Follows one location's structured GM-only fields. Only world GMs receive
 * the row; everyone else receives nothing and treats the location as
 * having no GM properties. GM notes arrive through the GM-only world
 * note, not here.
 */
export function listenToLocationGMProperties(
  worldId: string,
  locationId: string,
  updateGMProperties: (properties: GMLocation | undefined) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  const client = getSupabaseClient();

  return listenToRows<LocationGMDetailsRow>({
    client,
    channelName: constructLocationChannelName(locationId),
    bindings: [
      {
        type: "postgres_changes",
        table: WORLD_LOCATION_GM_DETAILS_TABLE,
        filter: constructLocationIdFilter(locationId),
        toChange: locationGMDetailsPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(WORLD_LOCATION_GM_DETAILS_TABLE)
        .select("*")
        .eq("location_id", locationId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as LocationGMDetailsRow[];
    },
    getKey: (row) => row.location_id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const row = rows.find((candidate) => candidate.location_id === locationId);
      updateGMProperties(row ? locationGMDetailsRowToDocument(row) : undefined);
    },
    onError,
  });
}
