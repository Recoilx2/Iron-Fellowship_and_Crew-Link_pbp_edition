import { describe, expect, it, vi, beforeEach } from "vitest";

import { setCampaignCharacterActive } from "api-calls/campaign/setCampaignCharacterActive";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

// Seam under test: retiring and reactivating a campaign character. Only the
// owner may do it, through the database function that swaps in one step;
// the database enforces the rest, so here the wrapper only forwards the
// call and surfaces failures.
describe("setCampaignCharacterActive", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
    mockedGetSupabaseClient.mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof getSupabaseClient>);
  });

  it("retires the character through the database swap", async () => {
    await setCampaignCharacterActive({
      uid: "user-A",
      characterId: "char-1",
      active: false,
    });

    expect(rpc).toHaveBeenCalledWith("set_campaign_character_active", {
      char_id: "char-1",
      make_active: false,
    });
  });

  it("reactivates the character through the same swap", async () => {
    await setCampaignCharacterActive({
      uid: "user-A",
      characterId: "char-1",
      active: true,
    });

    expect(rpc).toHaveBeenCalledWith("set_campaign_character_active", {
      char_id: "char-1",
      make_active: true,
    });
  });

  it("surfaces a refused swap", async () => {
    rpc.mockResolvedValue({ error: new Error("only the owner") });

    await expect(
      setCampaignCharacterActive({
        uid: "user-B",
        characterId: "char-1",
        active: false,
      })
    ).rejects.toBeTruthy();
  });
});
