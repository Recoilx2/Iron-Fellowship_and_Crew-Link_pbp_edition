import { createApiFunction } from "api-calls/createApiFunction";
import { removeWorldImageFile } from "api-calls/world/worldImageStorage";
import { updateNPC } from "./updateNPC";
import { logError } from "functions/errorReference";

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
    logError("removeNPCImage", e)
  );
}, "Failed to delete npc image.");
