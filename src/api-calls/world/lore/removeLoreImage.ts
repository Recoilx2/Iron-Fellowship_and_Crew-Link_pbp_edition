import { createApiFunction } from "api-calls/createApiFunction";
import { removeWorldImageFile } from "api-calls/world/worldImageStorage";
import { updateLore } from "./updateLore";

/**
 * Removes a lore image, clearing the lore's image list. Only world GMs
 * may write; the database and the bucket enforce it.
 */
export const removeLoreImage = createApiFunction<
  {
    worldId: string;
    loreId: string;
    filename: string;
  },
  void
>(async (params) => {
  const { worldId, loreId, filename } = params;
  await updateLore({
    worldId,
    loreId,
    lore: { imageFilenames: [] },
  });
  await removeWorldImageFile(worldId, loreId, filename).catch((e) =>
    console.error(e)
  );
}, "Failed to delete lore image.");
