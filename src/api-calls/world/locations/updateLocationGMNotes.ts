import { createApiFunction } from "api-calls/createApiFunction";
import { writeWorldNoteContent } from "api-calls/world/worldNotes";

interface Params {
  worldId: string;
  locationId: string;
  notes: Uint8Array;
  isBeacon?: boolean;
}

/**
 * Saves a location's GM-only notes bytes. Only world GMs may read or
 * write them; the database enforces it.
 */
export const updateLocationGMNotes = createApiFunction<Params, void>(
  async (params) => {
    const { worldId, locationId, notes } = params;
    await writeWorldNoteContent(worldId, "location", locationId, true, notes);
  },
  "Failed to update notes."
);
