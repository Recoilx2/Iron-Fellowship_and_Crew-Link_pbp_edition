import { createApiFunction } from "api-calls/createApiFunction";
import { removeWorldImageFile } from "api-calls/world/worldImageStorage";
import { updateLocation } from "./updateLocation";
import { logError } from "functions/errorReference";

/**
 * Removes a location's map background image. Only world GMs may write;
 * the database and the bucket enforce it.
 */
export const removeLocationMapBackgroundImage = createApiFunction<
  {
    worldId: string;
    locationId: string;
    filename: string;
  },
  void
>(async (params) => {
  const { worldId, locationId, filename } = params;
  await updateLocation({
    worldId,
    locationId,
    location: { mapBackgroundImageFilename: null },
  });
  await removeWorldImageFile(worldId, locationId, filename).catch((e) =>
    logError("removeLocationMapBackgroundImage", e)
  );
}, "Failed to delete location image.");
