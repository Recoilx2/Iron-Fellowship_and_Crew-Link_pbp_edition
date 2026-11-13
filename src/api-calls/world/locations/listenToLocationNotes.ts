import { Unsubscribe } from "api-calls/helpers.type";
import { listenToWorldItemNotes } from "api-calls/world/worldNotes";

/**
 * Follows one location's public notes bytes. Viewers of shared locations
 * receive them; outsiders and viewers of unshared locations receive
 * nothing. Combined with the world-notes document on the note server,
 * which owns the live bytes.
 */
export function listenToLocationNotes(
  worldId: string,
  locationId: string,
  updateLocationNotes: (notes: Uint8Array | undefined) => void,
  onError: (error: string) => void
): Unsubscribe {
  return listenToWorldItemNotes(
    "location",
    locationId,
    false,
    updateLocationNotes,
    onError
  );
}
