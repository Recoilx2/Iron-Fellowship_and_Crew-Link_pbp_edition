import { describe, expect, it } from "vitest";

import { groupCampaignCharactersByPlayer } from "pages/Campaign/CampaignPage/components/Tabs/CharacterTab/characterGrouping";
import type { CharacterDocument } from "api-calls/character/_character.type";

function makeCharacter(
  overrides: Partial<CharacterDocument> & { uid: string; name: string }
): CharacterDocument {
  return { stats: {}, momentum: 2, ...overrides };
}

// Seam under test: the Characters screen groups each player's campaign
// characters with the active one on top and the retired ones under it, so
// readers see at a glance who is playing whom. Players follow the roster
// order; anyone else sorts after them.
describe("groupCampaignCharactersByPlayer", () => {
  it("groups each player's characters with the active one first", () => {
    const groups = groupCampaignCharactersByPlayer(
      {
        "retired-1": makeCharacter({
          uid: "user-A",
          name: "Brannoc",
          campaignId: "camp-1",
          isActive: false,
        }),
        "active-1": makeCharacter({
          uid: "user-A",
          name: "Kira Vey",
          campaignId: "camp-1",
          isActive: true,
        }),
        "active-2": makeCharacter({
          uid: "user-B",
          name: "Sable",
          campaignId: "camp-1",
          isActive: true,
        }),
      },
      ["user-A", "user-B"]
    );

    expect(groups).toEqual([
      { uid: "user-A", characterIds: ["active-1", "retired-1"] },
      { uid: "user-B", characterIds: ["active-2"] },
    ]);
  });

  it("follows the roster order and sorts unknown players after them", () => {
    const groups = groupCampaignCharactersByPlayer(
      {
        "char-b": makeCharacter({ uid: "user-B", name: "Sable" }),
        "char-a": makeCharacter({ uid: "user-A", name: "Kira Vey" }),
        "char-z": makeCharacter({ uid: "user-Z", name: "Drifter" }),
      },
      ["user-A", "user-B"]
    );

    expect(groups.map((group) => group.uid)).toEqual([
      "user-A",
      "user-B",
      "user-Z",
    ]);
  });

  it("treats characters without a flag as active", () => {
    const groups = groupCampaignCharactersByPlayer(
      {
        "legacy-1": makeCharacter({ uid: "user-A", name: "Ash" }),
      },
      ["user-A"]
    );

    expect(groups).toEqual([
      { uid: "user-A", characterIds: ["legacy-1"] },
    ]);
  });
});
