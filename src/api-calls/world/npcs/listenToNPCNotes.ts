import { Unsubscribe } from "api-calls/helpers.type";
import { listenToWorldItemNotes } from "api-calls/world/worldNotes";

/**
 * Follows one NPC's public notes bytes. Viewers of shared NPCs receive
 * them; outsiders and viewers of unshared NPCs receive nothing.
 */
export function listenToNPCNotes(
  worldId: string,
  npcId: string,
  updateNPCNotes: (notes: Uint8Array | undefined) => void,
  onError: (error: string) => void
): Unsubscribe {
  return listenToWorldItemNotes("npc", npcId, false, updateNPCNotes, onError);
}
