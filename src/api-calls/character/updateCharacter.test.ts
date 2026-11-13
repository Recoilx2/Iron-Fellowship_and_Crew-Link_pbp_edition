import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateCharacter } from "api-calls/character/updateCharacter";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: an update that matches no row (a stranger's hijack is
// filtered out by RLS) must reject instead of resolving silently. The row
// fetch alone cannot tell: members may read rows they may not write.
const state = {
  row: null as Record<string, unknown> | null,
  updatedRows: [] as Array<{ id: string }>,
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.row = {
    id: "char-1",
    owner_id: "user-A",
    campaign_id: null,
    world_id: null,
    name: "Del Nar",
    stats: {},
    condition_meters: {},
    initiative_status: null,
    momentum: 2,
    special_tracks: {},
    experience: {},
    debilities: {},
    adds: null,
    profile_image: null,
    expansion_ids: [],
    custom_tracks: {},
    theme: null,
  };
  state.updatedRows = [{ id: "char-1" }];
  mockedGetSupabaseClient.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: state.row, error: null }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: async () => ({ data: state.updatedRows, error: null }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("updateCharacter matched-row contract", () => {
  it("resolves when the update matches the owned row", async () => {
    await expect(
      updateCharacter({ characterId: "char-1", character: { name: "Renamed" } })
    ).resolves.toBeUndefined();
  });

  it("rejects when the update matches no row", async () => {
    state.updatedRows = [];
    await expect(
      updateCharacter({ characterId: "char-1", character: { name: "Hijacked" } })
    ).rejects.toBeTruthy();
  });
});
