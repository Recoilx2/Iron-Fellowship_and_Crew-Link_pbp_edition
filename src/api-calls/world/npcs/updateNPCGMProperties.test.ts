import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateNPCGMProperties } from "api-calls/world/npcs/updateNPCGMProperties";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: the GM-details upsert matched-row contract. An upsert
// that matches no row (a player's write is filtered out by RLS) must
// reject instead of resolving silently.
const state = {
  current: null as Record<string, unknown> | null,
  upsertedRows: [] as Array<{ npc_id: string }>,
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.current = { descriptor: "Known" };
  state.upsertedRows = [{ npc_id: "npc-1" }];
  mockedGetSupabaseClient.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.current, error: null }),
        }),
      }),
      upsert: () => ({
        // The fixed code chains `.select()` onto the upsert (the #69
        // pattern) so an RLS-filtered write returns no rows.
        select: async () => ({ data: state.upsertedRows, error: null }),
      }),
    }),
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("updateNPCGMProperties matched-row contract", () => {
  it("resolves when the upsert matches the GM row", async () => {
    await expect(
      updateNPCGMProperties({
        worldId: "world-1",
        npcId: "npc-1",
        npcGMProperties: { descriptor: "Updated" },
      })
    ).resolves.toBeUndefined();
  });

  it("rejects when the upsert matches no row", async () => {
    state.upsertedRows = [];
    await expect(
      updateNPCGMProperties({
        worldId: "world-1",
        npcId: "npc-1",
        npcGMProperties: { descriptor: "Hijacked" },
      })
    ).rejects.toBeTruthy();
  });
});
