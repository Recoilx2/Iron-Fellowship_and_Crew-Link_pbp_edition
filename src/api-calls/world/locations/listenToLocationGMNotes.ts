import { Unsubscribe } from "api-calls/helpers.type";
import { listenToWorldItemNotes } from "api-calls/world/worldNotes";

/**
 * Follows one location's GM-only notes bytes. Only world GMs receive
 * them; everyone else receives nothing. Combined with the world-notes
 * document on the note server, which owns the live bytes.
 */
export function listenToLocationGMNotes(
  worldId: string,
  locationId: string,
  updateLocationGMNotes: (notes: Uint8Array | undefined) => void,
  onError: (error: string) => void
): Unsubscribe {
  return listenToWorldItemNotes(
    "location",
    locationId,
    true,
    updateLocationGMNotes,
    onError
  );
}
