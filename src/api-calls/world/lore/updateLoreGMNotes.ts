import { createApiFunction } from "api-calls/createApiFunction";
import { writeWorldNoteContent } from "api-calls/world/worldNotes";

interface Params {
  worldId: string;
  loreId: string;
  notes: Uint8Array;
  isBeacon?: boolean;
}

/**
 * Saves a lore document's GM-only notes bytes. Only world GMs may read or
 * write them; the database enforces it.
 */
export const updateLoreGMNotes = createApiFunction<Params, void>(
  async (params) => {
    const { worldId, loreId, notes } = params;
    await writeWorldNoteContent(worldId, "lore", loreId, true, notes);
  },
  "Failed to update notes."
);
