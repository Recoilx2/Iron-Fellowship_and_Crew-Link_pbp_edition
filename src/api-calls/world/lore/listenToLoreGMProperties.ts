import { Unsubscribe } from "api-calls/helpers.type";
import { GMLore } from "types/Lore.type";
import { listenToWorldItemNotes } from "api-calls/world/worldNotes";

/**
 * Follows one lore document's GM-only properties, which are its GM notes.
 * Only world GMs receive them; everyone else receives nothing and treats
 * the lore as having no GM properties.
 */
export function listenToLoreGMProperties(
  worldId: string,
  loreId: string,
  updateGMProperties: (properties: GMLore | undefined) => void,
  onError: (error: string) => void
): Unsubscribe {
  return listenToWorldItemNotes("lore", loreId, true, (notes) => {
    updateGMProperties(notes ? { gmNotes: notes } : undefined);
  }, onError);
}
