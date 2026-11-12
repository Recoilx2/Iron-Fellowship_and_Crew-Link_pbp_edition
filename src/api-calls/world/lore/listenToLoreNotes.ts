import { Unsubscribe } from "api-calls/helpers.type";
import { listenToWorldItemNotes } from "api-calls/world/worldNotes";

/**
 * Follows one lore document's public notes bytes. Viewers of shared lore
 * receive them; outsiders and viewers of unshared lore receive nothing.
 */
export function listenToLoreNotes(
  worldId: string,
  loreId: string,
  updateLoreNotes: (notes: Uint8Array | undefined) => void,
  onError: (error: string) => void
): Unsubscribe {
  return listenToWorldItemNotes("lore", loreId, false, updateLoreNotes, onError);
}
