import { createApiFunction } from "api-calls/createApiFunction";
import { removeWorldImageFile } from "api-calls/world/worldImageStorage";
import { updateLocation } from "./updateLocation";
import { logError } from "functions/errorReference";

/**
 * Removes a location image, clearing the location's image list. Only
 * world GMs may write; the database and the bucket enforce it.
 */
export const removeLocationImage = createApiFunction<
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
    location: { imageFilenames: [] },
  });
  await removeWorldImageFile(worldId, locationId, filename).catch((e) =>
    logError("removeLocationImage", e)
  );
}, "Failed to delete location image.");
