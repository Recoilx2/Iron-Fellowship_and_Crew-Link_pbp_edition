import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import {
  broadcastRowsBinding,
  listenToRowsDeferred,
} from "api-calls/realtime/listenToRows";
import {
  campaignBroadcastBindings,
  campaignIdsForWorld,
} from "api-calls/realtime/sharedTopics";
import { Location } from "types/Locations.type";
import { getWorldImageUrl } from "api-calls/world/worldImageStorage";
import {
  WORLD_LOCATIONS_TABLE,
  constructWorldLocationsChannelName,
  locationRowToDocument,
  type LocationRow,
} from "./_getRef";

/**
 * Follows every location in a world one person may see. The database
 * filters the rows: world GMs receive all locations, other viewers only
 * the shared ones, outsiders none. Image URLs resolve lazily per row.
 */
export function listenToLocations(
  worldId: string,
  updateLocation: (locationId: string, location: Location) => void,
  updateLocationImage: (locationId: string, imageUrl: string) => void,
  removeLocation: (locationId: string) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  const client = getSupabaseClient();
  let previousIds = new Set<string>();

  return listenToRowsDeferred<LocationRow>(
    async () => ({
      client,
      channelName: constructWorldLocationsChannelName(worldId),
      bindings: [
        ...(await campaignIdsForWorld(client, worldId)).flatMap((campaignId) =>
          campaignBroadcastBindings<LocationRow>(campaignId, "locations", () =>
            broadcastRowsBinding<LocationRow>({
              table: WORLD_LOCATIONS_TABLE,
              getKey: (row) => row.id,
            })
          )
        ),
      ],
      fetchRows: async () => {
        const { data, error } = await client
          .from(WORLD_LOCATIONS_TABLE)
          .select("*")
          .eq("world_id", worldId);
        if (error) {
          throw error;
        }
        return (data ?? []) as unknown as LocationRow[];
      },
      getKey: (row: LocationRow) => row.id,
      getUpdatedAt: (row: LocationRow) => row.updated_at,
      onRows: (rows: LocationRow[]) => {
        const seen = new Set<string>();
        for (const row of rows) {
          seen.add(row.id);
          updateLocation(row.id, locationRowToDocument(row));
          if (
            Array.isArray(row.image_filenames) &&
            row.image_filenames.length > 0
          ) {
            getWorldImageUrl(worldId, row.id, row.image_filenames[0])
              .then((url) => updateLocationImage(row.id, url))
              .catch(() => {});
          }
        }
        for (const id of previousIds) {
          if (!seen.has(id)) {
            removeLocation(id);
          }
        }
        previousIds = seen;
      },
      onError,
    }),
    onError
  );
}
