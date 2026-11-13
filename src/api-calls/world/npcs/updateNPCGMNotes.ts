import { createApiFunction } from "api-calls/createApiFunction";
import { writeWorldNoteContent } from "api-calls/world/worldNotes";

interface Params {
  worldId: string;
  npcId: string;
  notes: Uint8Array;
  isBeacon?: boolean;
}

/**
 * Saves an NPC's GM-only notes bytes. Only world GMs may read or write
 * them; the database enforces it.
 */
export const updateNPCGMNotes = createApiFunction<Params, void>(
  async (params) => {
    const { worldId, npcId, notes } = params;
    await writeWorldNoteContent(worldId, "npc", npcId, true, notes);
  },
  "Failed to update npc notes."
);
