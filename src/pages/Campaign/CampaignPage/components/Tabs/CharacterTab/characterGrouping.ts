import type { CharacterDocument } from "api-calls/character/_character.type";
import { isActiveCampaignCharacter } from "functions/isActiveCampaignCharacter";

export interface PlayerCharacterGroup {
  uid: string;
  characterIds: string[];
}

/**
 * Groups a campaign's characters by player for the Characters screen
 * (#127): each player's active character comes first, their retired ones
 * under it. Players follow the roster order; characters owned by anyone
 * else sort after them.
 */
export function groupCampaignCharactersByPlayer(
  characterMap: Record<string, CharacterDocument>,
  users: string[]
): PlayerCharacterGroup[] {
  const byPlayer = new Map<string, string[]>();
  for (const [characterId, character] of Object.entries(characterMap)) {
    const list = byPlayer.get(character.uid) ?? [];
    list.push(characterId);
    byPlayer.set(character.uid, list);
  }
  for (const [uid, characterIds] of byPlayer) {
    characterIds.sort((a, b) => {
      const aActive = isActiveCampaignCharacter(characterMap[a]);
      const bActive = isActiveCampaignCharacter(characterMap[b]);
      return Number(bActive) - Number(aActive);
    });
    byPlayer.set(uid, characterIds);
  }
  const order = new Map(users.map((uid, index) => [uid, index]));
  return [...byPlayer.entries()]
    .sort(
      ([a], [b]) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b) ?? Number.MAX_SAFE_INTEGER) || (a < b ? -1 : a > b ? 1 : 0)
    )
    .map(([uid, characterIds]) => ({ uid, characterIds }));
}
