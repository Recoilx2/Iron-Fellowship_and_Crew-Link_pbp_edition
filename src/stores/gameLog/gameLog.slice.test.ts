import { beforeEach, describe, expect, it, vi } from "vitest";

import { addRoll } from "api-calls/game-log/addRoll";
import { postCampaignRoll } from "api-calls/chat/postCampaignRoll";
import { createGameLogSlice } from "stores/gameLog/gameLog.slice";
import { defaultGameLogSlice } from "stores/gameLog/gameLog.slice.default";
import type { GameLogSlice } from "stores/gameLog/gameLog.slice.type";
import type { IStore } from "stores/store.type";
import { ROLL_RESULT, ROLL_TYPE, type Roll } from "types/DieRolls.type";

vi.mock("api-calls/game-log/addRoll");
vi.mock("api-calls/chat/postCampaignRoll");

const mockedAddRoll = vi.mocked(addRoll);
const mockedPostCampaignRoll = vi.mocked(postCampaignRoll);

function statRoll(overrides: Partial<Roll> = {}): Roll {
  return {
    type: ROLL_TYPE.STAT,
    rollLabel: "Edge",
    action: 4,
    challenge1: 3,
    challenge2: 8,
    result: ROLL_RESULT.WEAK_HIT,
    timestamp: new Date("2026-11-13T12:00:00.000Z"),
    characterId: "kira",
    uid: "player-1",
    gmsOnly: false,
    ...overrides,
  } as Roll;
}

// Seam under test: gameLog.addRoll routes campaign rolls into chat (the
// starting IC channel, as the channel-kind speaker) and keeps solo rolls in
// the character log. The channel write itself is covered by the live
// access-rule tests; here both writers are stubs.
function setUpSlice(options: {
  uid?: string;
  characterMap?: Record<string, { uid: string }>;
} = {}) {
  const { uid = "player-1", characterMap = {} } = options;
  const draft = { gameLog: { ...defaultGameLogSlice } };
  const set = (fn: (store: typeof draft) => void) => {
    fn(draft);
  };
  const get = () =>
    ({
      auth: { uid },
      campaigns: {
        currentCampaign: {
          currentCampaignId: "campaign-1",
          characters: { characterMap },
        },
      },
    }) as unknown as IStore;
  const slice = createGameLogSlice(
    set as never,
    get as never,
    undefined as never
  ) as GameLogSlice;
  return slice;
}

describe("gameLog.addRoll routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedAddRoll.mockResolvedValue("log-1");
    mockedPostCampaignRoll.mockResolvedValue("post-1");
  });

  it("posts a campaign roll to chat as the player's campaign character", async () => {
    const slice = setUpSlice({
      characterMap: { kira: { uid: "player-1" } },
    });
    const roll = statRoll();

    const id = await slice.addRoll({ campaignId: "campaign-1", roll });

    expect(id).toBe("post-1");
    expect(mockedPostCampaignRoll).toHaveBeenCalledWith({
      campaignId: "campaign-1",
      speakerCharacterId: "kira",
      roll,
    });
    expect(mockedAddRoll).not.toHaveBeenCalled();
  });

  it("posts a campaign roll as nobody when the roller has no campaign character", async () => {
    const slice = setUpSlice({ uid: "gm-1", characterMap: {} });

    await slice.addRoll({
      campaignId: "campaign-1",
      roll: statRoll({ characterId: null, uid: "gm-1" }),
    });

    expect(mockedPostCampaignRoll).toHaveBeenCalledWith({
      campaignId: "campaign-1",
      speakerCharacterId: null,
      roll: expect.objectContaining({ uid: "gm-1" }),
    });
  });

  it("keeps a solo roll in the character log", async () => {
    const slice = setUpSlice();
    const roll = statRoll();

    const id = await slice.addRoll({ characterId: "solo-1", roll });

    expect(id).toBe("log-1");
    expect(mockedAddRoll).toHaveBeenCalledWith({
      characterId: "solo-1",
      roll,
    });
    expect(mockedPostCampaignRoll).not.toHaveBeenCalled();
  });

  it("rejects a roll with nowhere to go", async () => {
    const slice = setUpSlice();

    await expect(slice.addRoll({ roll: statRoll() })).rejects.toBeTruthy();
    expect(mockedAddRoll).not.toHaveBeenCalled();
    expect(mockedPostCampaignRoll).not.toHaveBeenCalled();
  });
});
