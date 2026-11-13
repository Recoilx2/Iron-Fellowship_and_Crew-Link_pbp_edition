import { Unsubscribe } from "api-calls/helpers.type";
import { listenToWorldItemNotes } from "api-calls/world/worldNotes";

/**
 * Follows one NPC's GM-only notes bytes. Only world GMs receive them;
 * everyone else receives nothing.
 */
export function listenToNPCGMNotes(
  worldId: string,
  npcId: string,
  updateNPCGMNotes: (notes: Uint8Array | undefined) => void,
  onError: (error: string) => void
): Unsubscribe {
  return listenToWorldItemNotes("npc", npcId, true, updateNPCGMNotes, onError);
}
