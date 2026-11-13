import { createApiFunction } from "api-calls/createApiFunction";
import { GMLore } from "types/Lore.type";
import { writeWorldNoteContent } from "api-calls/world/worldNotes";

interface Params {
  worldId: string;
  loreId: string;
  loreGMProperties: Partial<GMLore>;
}

/**
 * Saves lore's GM-only properties. Lore's only GM-only datum is its GM
 * notes, so this writes the GM-only world note. Only world GMs may read
 * or write it; the database enforces it.
 */
export const updateLoreGMProperties = createApiFunction<Params, void>(
  async (params) => {
    const { worldId, loreId, loreGMProperties } = params;
    if (loreGMProperties.gmNotes) {
      await writeWorldNoteContent(
        worldId,
        "lore",
        loreId,
        true,
        loreGMProperties.gmNotes
      );
    }
  },
  "Failed to update lore document."
);
