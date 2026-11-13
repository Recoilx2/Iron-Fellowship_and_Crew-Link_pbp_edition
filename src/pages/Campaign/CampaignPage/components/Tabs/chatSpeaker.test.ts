import { describe, expect, it } from "vitest";

import { defaultChatSpeaker } from "pages/Campaign/CampaignPage/components/Tabs/chatSpeaker";

// Seam under test: the composer's speaker line. Players have no picker (one
// character per campaign), so the channel kind picks the speaker: IC means
// their campaign character, OOC means themselves. GMs start as themselves
// (the GM tag is a label, not a speaker) and pick an NPC voice from the
// campaign world's NPC list in the composer.
describe("default chat speaker", () => {
  it("posts in character as the player's campaign character", () => {
    expect(defaultChatSpeaker("IC", "kira")).toEqual({
      characterId: "kira",
      npcId: null,
    });
  });

  it("posts out of character as self", () => {
    expect(defaultChatSpeaker("OOC", "kira")).toEqual({
      characterId: null,
      npcId: null,
    });
  });

  it("posts as self in character with no campaign character", () => {
    expect(defaultChatSpeaker("IC", undefined)).toEqual({
      characterId: null,
      npcId: null,
    });
  });
});
