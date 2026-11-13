import { createApiFunction } from "api-calls/createApiFunction";
import { removeWorldImageFile } from "api-calls/world/worldImageStorage";
import { updateNPC } from "./updateNPC";

/**
 * Removes an NPC image, clearing the NPC's image list. Only world GMs may
 * write; the database and the bucket enforce it.
 */
export const removeNPCImage = createApiFunction<
  {
    worldId: string;
    npcId: string;
    filename: string;
  },
  void
>(async (params) => {
  const { worldId, npcId, filename } = params;
  await updateNPC({
    worldId,
    npcId,
    npc: { imageFilenames: [] },
  });
  await removeWorldImageFile(worldId, npcId, filename).catch((e) =>
    console.error(e)
  );
}, "Failed to delete npc image.");
