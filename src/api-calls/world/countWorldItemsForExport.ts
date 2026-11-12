import { getCountFromServer, query, where } from "firebase/firestore";
import { getNPCCollection } from "./npcs/_getRef";
import { getLoreCollection } from "./lore/_getRef";
import { getLocationCollection } from "./locations/_getRef";

export interface WorldItemExportCounts {
  npcCount: number;
  loreCount: number;
  locationCount: number;
}

/**
 * Counts the world entities readable by the requesting person, for export
 * progress reporting. Non-owners only see entities shared with players.
 */
export async function countWorldItemsForExport(
  worldId: string,
  isOwner: boolean
): Promise<WorldItemExportCounts> {
  const [npcCount, loreCount, locationCount] = await Promise.all([
    getCountFromServer(
      isOwner
        ? getNPCCollection(worldId)
        : query(
            getNPCCollection(worldId),
            where("sharedWithPlayers", "==", true)
          )
    ).then((result) => result.data().count),
    getCountFromServer(
      isOwner
        ? getLoreCollection(worldId)
        : query(
            getLoreCollection(worldId),
            where("sharedWithPlayers", "==", true)
          )
    ).then((result) => result.data().count),
    getCountFromServer(
      isOwner
        ? getLocationCollection(worldId)
        : query(
            getLocationCollection(worldId),
            where("sharedWithPlayers", "==", true)
          )
    ).then((result) => result.data().count),
  ]);

  return { npcCount, loreCount, locationCount };
}
