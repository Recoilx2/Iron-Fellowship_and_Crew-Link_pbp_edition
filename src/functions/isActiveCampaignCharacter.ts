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
