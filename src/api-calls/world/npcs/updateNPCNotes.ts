import { createApiFunction } from "api-calls/createApiFunction";
import { writeWorldNoteContent } from "api-calls/world/worldNotes";

interface Params {
  worldId: string;
  npcId: string;
  notes: Uint8Array;
  isBeacon?: boolean;
}

/**
 * Saves an NPC's public notes bytes. The note server owns the live
 * document and writes the same row on its debounce; this is the fallback
 * path. Only world GMs may write; the database enforces it.
 */
export const updateNPCNotes = createApiFunction<Params, void>(
  async (params) => {
    const { worldId, npcId, notes } = params;
    await writeWorldNoteContent(worldId, "npc", npcId, false, notes);
  },
  "Failed to save changes to npc notes."
);
