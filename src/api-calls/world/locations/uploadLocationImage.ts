import {
  removeWorldImageFile,
  uploadWorldImageFile,
} from "api-calls/world/worldImageStorage";
import { updateLocation } from "./updateLocation";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Uploads a location image, shrinking it in the browser first. The new
 * file replaces the location's image list; the old file is removed.
 * Only world GMs may write; the database and the bucket enforce it.
 */
export const uploadLocationImage = createApiFunction<
  {
    worldId: string;
    locationId: string;
    image: File;
    oldImageFilename?: string;
  },
  void
>(async (params) => {
  const { worldId, locationId, image, oldImageFilename } = params;
  const filename = await uploadWorldImageFile(worldId, locationId, image);
  await updateLocation({
    worldId,
    locationId,
    location: { imageFilenames: [filename] },
  });
  if (oldImageFilename && oldImageFilename !== filename) {
    await removeWorldImageFile(worldId, locationId, oldImageFilename).catch(
      (e) => console.error(e)
    );
  }
}, "Failed to upload image");
