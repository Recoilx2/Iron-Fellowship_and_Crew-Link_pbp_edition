import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteCharacter } from "api-calls/character/deleteCharacter";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: a delete that matches no row (a stranger's delete is
// filtered out by RLS) must reject instead of resolving silently.
const state = {
  deletedRows: [] as Array<{ id: string }>,
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.deletedRows = [{ id: "char-1" }];
  mockedGetSupabaseClient.mockReturnValue({
    from: () => ({
      delete: () => ({
        eq: () => ({
          select: async () => ({ data: state.deletedRows, error: null }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("deleteCharacter matched-row contract", () => {
  it("resolves when the delete matches the owned row", async () => {
    await expect(
      deleteCharacter({ uid: "user-A", characterId: "char-1" })
    ).resolves.toBeUndefined();
  });

  it("rejects when the delete matches no row", async () => {
    state.deletedRows = [];
    await expect(
      deleteCharacter({ uid: "user-B", characterId: "char-1" })
    ).rejects.toBeTruthy();
  });
});
