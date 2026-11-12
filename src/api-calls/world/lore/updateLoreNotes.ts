import { createApiFunction } from "api-calls/createApiFunction";
import { writeWorldNoteContent } from "api-calls/world/worldNotes";

interface Params {
  worldId: string;
  loreId: string;
  notes: Uint8Array;
  isBeacon?: boolean;
}

/**
 * Saves a lore document's public notes bytes. The note server owns the
 * live document and writes the same row on its debounce; this is the
 * fallback path. Only world GMs may write; the database enforces it.
 */
export const updateLoreNotes = createApiFunction<Params, void>(
  async (params) => {
    const { worldId, loreId, notes } = params;
    await writeWorldNoteContent(worldId, "lore", loreId, false, notes);
  },
  "Failed to save changes to notes."
);
