import { describe, expect, it } from "vitest";

import {
  findActiveCampaignCharacter,
  isActiveCampaignCharacter,
} from "functions/isActiveCampaignCharacter";

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

describe("findActiveCampaignCharacter", () => {
  const map = {
    kira: { uid: "player-1", isActive: true as boolean | undefined },
    sable: { uid: "player-1", isActive: false as boolean | undefined },
    brack: { uid: "player-2", isActive: true as boolean | undefined },
    old: { uid: "player-1" },
  };

  it("finds the player's active character entry", () => {
    expect(findActiveCampaignCharacter(map, "player-1")).toEqual([
      "kira",
      map.kira,
    ]);
  });

  it("skips retired characters and other players", () => {
    expect(findActiveCampaignCharacter(map, "player-2")).toEqual([
      "brack",
      map.brack,
    ]);
  });

  it("returns undefined when the player has no active character", () => {
    expect(
      findActiveCampaignCharacter(
        { sable: map.sable, brack: map.brack },
        "player-1"
      )
    ).toBeUndefined();
  });

  it("scopes the search to one campaign", () => {
    const scoped = {
      a: { uid: "player-1", campaignId: "camp-1", isActive: true },
      b: { uid: "player-1", campaignId: "camp-2", isActive: true },
    };
    expect(
      findActiveCampaignCharacter(scoped, "player-1", "camp-2")
    ).toEqual([
      "b",
      { uid: "player-1", campaignId: "camp-2", isActive: true },
    ]);
    expect(
      findActiveCampaignCharacter(scoped, "player-1", "camp-3")
    ).toBeUndefined();
  });
});
