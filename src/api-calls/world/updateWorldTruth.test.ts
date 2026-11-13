import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateWorldTruth } from "api-calls/world/updateWorldTruth";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: the world-truth update matched-row contract. The merge
// read alone cannot tell a GM from a player (members may read rows they
// may not write), so an update that matches no row must reject instead of
// resolving silently (the #69 class, issue #91).
const state = {
  row: null as Record<string, unknown> | null,
  updatedRows: [] as Array<{ id: string }>,
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.row = { new_truths: {} };
  state.updatedRows = [{ id: "world-1" }];
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

describe("updateWorldTruth matched-row contract", () => {
  it("resolves when the update matches the world row", async () => {
    await expect(
      updateWorldTruth({
        worldId: "world-1",
        truthKey: "cataclysm",
        truth: { selectedTruthOptionIndex: 1 },
      })
    ).resolves.toBeUndefined();
  });

  it("rejects when the update matches no row", async () => {
    state.updatedRows = [];
    await expect(
      updateWorldTruth({
        worldId: "world-1",
        truthKey: "cataclysm",
        truth: { selectedTruthOptionIndex: 2 },
      })
    ).rejects.toBeTruthy();
  });
});
