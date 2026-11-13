import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateWorldDescription } from "api-calls/world/updateWorldDescription";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: the world-description update matched-row contract (the
// fallback path; the beacon path is fire-and-forget on page unload and has
// no caller to reject to). A description write that matches no row must
// reject instead of resolving silently (the #69 class, issue #91).
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

describe("updateWorldDescription matched-row contract", () => {
  it("resolves when the update matches the world row", async () => {
    await expect(
      updateWorldDescription({
        worldId: "world-1",
        description: new Uint8Array([1, 2, 3]),
      })
    ).resolves.toBeUndefined();
  });

  it("rejects when the update matches no row", async () => {
    state.updatedRows = [];
    await expect(
      updateWorldDescription({
        worldId: "world-1",
        description: new Uint8Array([9, 9, 9]),
      })
    ).rejects.toBeTruthy();
  });
});
