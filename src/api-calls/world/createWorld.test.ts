import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorld } from "api-calls/world/createWorld";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: createWorld insert plumbing. The inserted row must carry
// a client-generated UUID id and the call must resolve to that id without
// a `.select()`: INSERT...RETURNING on worlds fails RLS because the worlds
// SELECT policy re-queries its own table (#74).
const state = {
  inserted: [] as Array<{ table: string; row: Record<string, unknown> }>,
  insertError: null as null | { message: string },
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.inserted = [];
  state.insertError = null;
  mockedGetSupabaseClient.mockReturnValue({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-A" } },
        error: null,
      }),
    },
    from: (table: string) => ({
      // No `.select()` on the insert builder on purpose: the fixed code
      // must not call it (PostgREST would send Prefer:
      // return=representation, which worlds RLS rejects).
      insert: (row: Record<string, unknown>) => {
        state.inserted.push({ table, row });
        return { error: state.insertError };
      },
    }),
    // The world insert path never touches the other clients.
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("createWorld insert plumbing", () => {
  it("inserts the world with a client-generated id and resolves to it", async () => {
    const worldId = await createWorld({
      name: "Ironlands",
      settingKey: "ironlands",
    });

    const worldInsert = state.inserted.find(
      (entry) => entry.table === "worlds"
    );
    expect(worldInsert?.row.id).toMatch(UUID_RE);
    expect(worldId).toBe(worldInsert?.row.id);
    expect(worldInsert?.row).toMatchObject({
      name: "Ironlands",
      setting_key: "ironlands",
      owner_ids: ["user-A"],
    });
  });

  it("surfaces insert errors instead of resolving", async () => {
    state.insertError = { message: "boom" };

    await expect(createWorld({})).rejects.toMatchObject({ message: "boom" });
  });

  it("refuses to create when nobody is signed in instead of hitting RLS", async () => {
    mockedGetSupabaseClient.mockReturnValueOnce({
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    } as unknown as ReturnType<typeof getSupabaseClient>);

    await expect(createWorld({})).rejects.toThrow();
    expect(state.inserted).toHaveLength(0);
  });
});
