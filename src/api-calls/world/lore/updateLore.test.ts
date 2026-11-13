import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateLore } from "api-calls/world/lore/updateLore";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: the lore update matched-row contract. The row fetch
// alone cannot tell a GM from a player (members may read shared rows they
// may not write), so an update that matches no row must reject instead of
// resolving silently (the #69 class, issue #91).
const state = {
  row: null as Record<string, unknown> | null,
  updatedRows: [] as Array<{ id: string }>,
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.row = { id: "lore-1", world_id: "world-1", name: "Chronicle" };
  state.updatedRows = [{ id: "lore-1" }];
  mockedGetSupabaseClient.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: state.row, error: null }),
          }),
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

describe("updateLore matched-row contract", () => {
  it("resolves when the update matches the world row", async () => {
    await expect(
      updateLore({
        worldId: "world-1",
        loreId: "lore-1",
        lore: { name: "Renamed" },
      })
    ).resolves.toBeUndefined();
  });

  it("rejects when the update matches no row", async () => {
    state.updatedRows = [];
    await expect(
      updateLore({
        worldId: "world-1",
        loreId: "lore-1",
        lore: { name: "Hijacked" },
      })
    ).rejects.toBeTruthy();
  });
});
