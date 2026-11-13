import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateWorld } from "api-calls/world/updateWorld";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: the world update matched-row contract. A world row that
// is readable but not writable (a linked campaign's player, or anyone past
// unlinking) must make the update reject instead of resolving silently
// (the #69 class, issue #91).
const state = {
  updatedRows: [] as Array<{ id: string }>,
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.updatedRows = [{ id: "world-1" }];
  mockedGetSupabaseClient.mockReturnValue({
    from: () => ({
      update: () => ({
        eq: () => ({
          select: async () => ({ data: state.updatedRows, error: null }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("updateWorld matched-row contract", () => {
  it("resolves when the update matches the world row", async () => {
    await expect(
      updateWorld({ worldId: "world-1", partialWorld: { name: "Renamed" } })
    ).resolves.toBeUndefined();
  });

  it("rejects when the update matches no row", async () => {
    state.updatedRows = [];
    await expect(
      updateWorld({ worldId: "world-1", partialWorld: { name: "Hijacked" } })
    ).rejects.toBeTruthy();
  });
});
