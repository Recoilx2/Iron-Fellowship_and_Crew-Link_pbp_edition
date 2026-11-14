import { describe, expect, it } from "vitest";

import { isActiveCampaignCharacter } from "functions/isActiveCampaignCharacter";

// Seam under test: the active-character predicate. Every active-only lookup
// (chat name line, composer speaker, sheet-roll routing, Characters screen
// grouping, add dialog) answers one question -- is this campaign character
// the player's active one -- so the tri-state answer lives here, not in six
// copies of the comparison.
describe("isActiveCampaignCharacter", () => {
  it("treats an explicitly active character as active", () => {
    expect(isActiveCampaignCharacter({ isActive: true })).toBe(true);
  });

  it("treats a character without a flag as active", () => {
    // Documents written before the flag existed (#127) stay playable: an
    // absent isActive means active.
    expect(isActiveCampaignCharacter({})).toBe(true);
  });

  it("treats a retired character as inactive", () => {
    expect(isActiveCampaignCharacter({ isActive: false })).toBe(false);
  });

  it("treats a missing character as not active", () => {
    expect(isActiveCampaignCharacter(null)).toBe(false);
    expect(isActiveCampaignCharacter(undefined)).toBe(false);
  });
});
