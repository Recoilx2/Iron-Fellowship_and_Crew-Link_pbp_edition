import { describe, expect, it, vi, beforeEach } from "vitest";

import { postCampaignRoll } from "api-calls/chat/postCampaignRoll";
import { createPost } from "api-calls/chat/createPost";
import { getSupabaseClient } from "config/supabase.config";
import { ROLL_RESULT, ROLL_TYPE, type Roll } from "types/DieRolls.type";

vi.mock("config/supabase.config");
vi.mock("api-calls/chat/createPost");

const mockedClient = vi.mocked(getSupabaseClient);
const mockedCreatePost = vi.mocked(createPost);

function statRoll(overrides: Partial<Roll> = {}): Roll {
  return {
    type: ROLL_TYPE.STAT,
    rollLabel: "Edge",
    action: 4,
    challenge1: 3,
    challenge2: 8,
    result: ROLL_RESULT.WEAK_HIT,
    timestamp: new Date("2026-11-13T12:00:00.000Z"),
    characterId: "character-1",
    uid: "player-1",
    gmsOnly: false,
    ...overrides,
  } as Roll;
}

// Seam under test: the campaign roll funnel. Rolls made elsewhere carry
// the open sheet's character, which may not be the post's speaker, so the
// funnel stamps the roll's identity from the post before writing: the
// database binds a posted roll to its post and would refuse the mismatch.
function setUpClient() {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              limit: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: "ic-1" },
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    }),
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { id: "player-1" } } },
          error: null,
        }),
    },
  };
  mockedClient.mockReturnValue(client as never);
  mockedCreatePost.mockResolvedValue("post-1");
}

describe("postCampaignRoll", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setUpClient();
  });

  it("stamps a sheet roll with the post's speaker and author", async () => {
    const id = await postCampaignRoll({
      campaignId: "campaign-1",
      speakerCharacterId: "kira",
      roll: statRoll({ characterId: "other-sheet", uid: "player-1" }),
    });

    expect(id).toBe("post-1");
    expect(mockedCreatePost).toHaveBeenCalledWith({
      channelId: "ic-1",
      text: "",
      speakerCharacterId: "kira",
      roll: expect.objectContaining({ characterId: "kira", uid: "player-1" }),
      gmsOnly: false,
    });
  });

  it("stamps a self roll with no character", async () => {
    await postCampaignRoll({
      campaignId: "campaign-1",
      speakerCharacterId: null,
      roll: statRoll({ characterId: "other-sheet", uid: "player-1" }),
    });

    expect(mockedCreatePost).toHaveBeenCalledWith({
      channelId: "ic-1",
      text: "",
      speakerCharacterId: null,
      roll: expect.objectContaining({ characterId: null, uid: "player-1" }),
      gmsOnly: false,
    });
  });
});
