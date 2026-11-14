/**
 * Whether a campaign character counts as the player's active one (#127).
 *
 * At most one character per player per campaign is active; the rest are
 * retired (inactive) and can be made active again. A missing character (no
 * row for the lookup) is never active. An absent flag also reads as
 * active, so partial character views without the flag stay playable.
 */
export function isActiveCampaignCharacter(
  character: { isActive?: boolean } | null | undefined
): boolean {
  if (character == null) {
    return false;
  }
  return character.isActive !== false;
}

/**
 * Finds the player's active campaign character in a character map (#127).
 *
 * The uid-plus-active lookup repeats in the composer, the name line, the
 * sheet-roll routing and the add dialog: it lives here so the active rule
 * above stays in one place. Pass a campaign id to scope the search to one
 * campaign -- a player can be active in several campaigns at once.
 * Returns the map entry, or undefined when the player has no active
 * character there.
 */
export function findActiveCampaignCharacter<
  T extends { uid: string; campaignId?: string | null; isActive?: boolean },
>(
  characterMap: Record<string, T>,
  uid: string,
  campaignId?: string
): [string, T] | undefined {
  return Object.entries(characterMap).find(
    ([, character]) =>
      character.uid === uid &&
      (campaignId === undefined || character.campaignId === campaignId) &&
      isActiveCampaignCharacter(character)
  );
}
