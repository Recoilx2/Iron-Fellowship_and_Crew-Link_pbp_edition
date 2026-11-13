import {
  removeWorldImageFile,
  uploadWorldImageFile,
} from "api-calls/world/worldImageStorage";
import { updateLore } from "./updateLore";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Uploads a lore image, shrinking it in the browser first. The new file
 * replaces the lore's image list; the old file is removed. Only world
 * GMs may write; the database and the bucket enforce it.
 */
export const uploadLoreImage = createApiFunction<
  {
    worldId: string;
    loreId: string;
    image: File;
    oldImageFilename?: string;
  },
  void
>(async (params) => {
  const { worldId, loreId, image, oldImageFilename } = params;
  const filename = await uploadWorldImageFile(worldId, loreId, image);
  await updateLore({
    worldId,
    loreId,
    lore: { imageFilenames: [filename] },
  });
  if (oldImageFilename && oldImageFilename !== filename) {
    await removeWorldImageFile(worldId, loreId, oldImageFilename).catch(
      (e) => console.error(e)
    );
  }
}, "Failed to upload image");
