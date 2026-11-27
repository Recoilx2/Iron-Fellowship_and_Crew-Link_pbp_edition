import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import {
  broadcastRowsBinding,
  listenToRowsDeferred,
} from "api-calls/realtime/listenToRows";
import {
  campaignGmTopic,
  campaignIdsForWorld,
} from "api-calls/realtime/sharedTopics";
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

  return listenToRowsDeferred<LocationGMDetailsRow>(
    async () => ({
      client,
      channelName: constructLocationChannelName(locationId),
      bindings: [
        // GM-only rows are published only on campaign-gm:*: players never
        // receive even their ids, and their denied joins stay silent.
        ...(await campaignIdsForWorld(client, worldId)).map((campaignId) =>
          broadcastRowsBinding<LocationGMDetailsRow>({
            topic: campaignGmTopic(campaignId, "world"),
            optional: true,
            table: WORLD_LOCATION_GM_DETAILS_TABLE,
            getKey: (row) => row.location_id,
          })
        ),
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
      getKey: (row: LocationGMDetailsRow) => row.location_id,
      getUpdatedAt: (row: LocationGMDetailsRow) => row.updated_at,
      onRows: (rows: LocationGMDetailsRow[]) => {
        const row = rows.find(
          (candidate) => candidate.location_id === locationId
        );
        updateGMProperties(row ? locationGMDetailsRowToDocument(row) : undefined);
      },
      onError,
    }),
    onError
  );
}
