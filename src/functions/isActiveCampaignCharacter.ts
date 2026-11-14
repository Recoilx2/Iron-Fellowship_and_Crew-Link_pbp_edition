/**
 * Whether a campaign character counts as the player's active one (#127).
 *
 * At most one character per player per campaign is active; the rest are
 * retired (inactive) and can be made active again. `isActive` is tri-state
 * on purpose: documents written before the flag existed carry no value and
 * stay playable, so an absent flag means active. A missing character (no
 * row for the lookup) is never the active one.
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
 * sheet-roll routing and the add dialog: it lives here so the tri-state
 * rule above stays in one place. Returns the map entry, or undefined when
 * the player has no active character.
 */
export function findActiveCampaignCharacter<
  T extends { uid: string; isActive?: boolean },
>(characterMap: Record<string, T>, uid: string): [string, T] | undefined {
  return Object.entries(characterMap).find(
    ([, character]) =>
      character.uid === uid && isActiveCampaignCharacter(character)
  );
}
