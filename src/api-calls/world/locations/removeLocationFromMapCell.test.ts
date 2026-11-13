import { beforeEach, describe, expect, it, vi } from "vitest";

import { removeLocationFromMapCell } from "api-calls/world/locations/removeLocationFromMapCell";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: the map-cell update matched-row contract. The map read
// alone cannot tell a GM from a player (members may read shared rows they
// may not write), so an update that matches no row must reject instead of
// resolving silently (the #69 class, issue #91).
const state = {
  row: null as Record<string, unknown> | null,
  updatedRows: [] as Array<{ id: string }>,
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.row = { id: "map-1", world_id: "world-1", name: "Region" };
  state.updatedRows = [{ id: "map-1" }];
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

describe("removeLocationFromMapCell matched-row contract", () => {
  it("resolves when the update matches the map row", async () => {
    await expect(
      removeLocationFromMapCell({
        worldId: "world-1",
        mapLocationId: "map-1",
        row: 0,
        col: 0,
        locationId: "location-1",
      })
    ).resolves.toBeUndefined();
  });

  it("rejects when the update matches no row", async () => {
    state.updatedRows = [];
    await expect(
      removeLocationFromMapCell({
        worldId: "world-1",
        mapLocationId: "map-1",
        row: 0,
        col: 0,
        locationId: "location-1",
      })
    ).rejects.toBeTruthy();
  });
});
