import {
  removeWorldImageFile,
  uploadWorldImageFile,
} from "api-calls/world/worldImageStorage";
import { updateNPC } from "./updateNPC";
import { createApiFunction } from "api-calls/createApiFunction";

/**
 * Uploads an NPC image, shrinking it in the browser first. The new file
 * replaces the NPC's image list; the old file is removed. Only world GMs
 * may write; the database and the bucket enforce it.
 */
export const uploadNPCImage = createApiFunction<
  {
    worldId: string;
    npcId: string;
    image: File;
    oldImageFilename?: string;
  },
  void
>(async (params) => {
  const { worldId, npcId, image, oldImageFilename } = params;
  const filename = await uploadWorldImageFile(worldId, npcId, image);
  await updateNPC({
    worldId,
    npcId,
    npc: { imageFilenames: [filename] },
  });
  if (oldImageFilename && oldImageFilename !== filename) {
    await removeWorldImageFile(worldId, npcId, oldImageFilename).catch((e) =>
      console.error(e)
    );
  }
}, "Failed to upload image");
