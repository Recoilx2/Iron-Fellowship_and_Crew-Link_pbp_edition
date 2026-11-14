import { beforeEach, describe, expect, it, vi } from "vitest";

import { addCharacterToCampaign } from "api-calls/campaign/addCharacterToCampaign";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: adding a character to a campaign where the player
// already plays one. At most one character per player per campaign is
// active (#127): the new character links first (inactive while another is
// active), then a swap retires the active one and activates the new one in
// a single database call -- so if either step fails, the player's old
// active character is untouched and never left with none.
interface CharacterRow {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  is_active: boolean;
}

const state = {
  sessionUserId: "user-A",
  rows: [] as CharacterRow[],
  updates: [] as Array<{ values: Record<string, unknown>; id: string }>,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  failRpc: false,
};

interface Filter {
  op: "eq" | "neq";
  col: string;
  value: unknown;
}

function applyFilters(rows: CharacterRow[], filters: Filter[]): CharacterRow[] {
  return rows.filter((row) =>
    filters.every(({ op, col, value }) => {
      const field = (row as unknown as Record<string, unknown>)[col];
      return op === "eq" ? field === value : field !== value;
    })
  );
}

function selectBuilder(table: string, filters: Filter[]) {
  const builder = {
    eq: (col: string, value: unknown) => {
      filters.push({ op: "eq", col, value });
      return builder;
    },
    neq: (col: string, value: unknown) => {
      filters.push({ op: "neq", col, value });
      return builder;
    },
    then: (
      onFulfilled: (result: { data: unknown; error: null }) => unknown
    ) => {
      if (table === "campaigns") {
        return Promise.resolve({ data: [{ id: "camp-1" }], error: null }).then(
          onFulfilled
        );
      }
      return Promise.resolve({
        data: applyFilters(state.rows, filters).map((row) => ({ id: row.id })),
        error: null,
      }).then(onFulfilled);
    },
  };
  return builder;
}

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.sessionUserId = "user-A";
  state.rows = [];
  state.updates = [];
  state.rpcCalls = [];
  state.failRpc = false;
  mockedGetSupabaseClient.mockReturnValue({
    auth: {
      getSession: async () => ({
        data: {
          session: state.sessionUserId
            ? {
                user: { id: state.sessionUserId },
                access_token: `token-for-${state.sessionUserId}`,
              }
            : null,
        },
        error: null,
      }),
    },
    from: (table: string) => ({
      select: () => selectBuilder(table, []),
      update: (values: Record<string, unknown>) => ({
        eq: (col: string, value: unknown) => {
          if (table === "characters" && col === "id") {
            const row = state.rows.find((entry) => entry.id === value);
            if (row) {
              for (const [key, entry] of Object.entries(values)) {
                (row as unknown as Record<string, unknown>)[key] = entry;
              }
            }
            state.updates.push({ values, id: value as string });
          }
          return {
            select: () =>
              Promise.resolve({ data: [{ id: value }], error: null }),
          };
        },
      }),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      if (state.failRpc) {
        return Promise.resolve({ error: new Error("swap failed") });
      }
      if (fn === "set_campaign_character_active" && args.make_active) {
        const row = state.rows.find(
          (entry) => entry.id === (args.char_id as string)
        );
        if (row) {
          for (const other of state.rows) {
            if (
              other.owner_id === row.owner_id &&
              other.campaign_id === row.campaign_id &&
              other.id !== row.id
            ) {
              other.is_active = false;
            }
          }
          row.is_active = true;
        }
      }
      return Promise.resolve({ error: null });
    },
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

function seed(rows: CharacterRow[]): void {
  state.rows = rows.map((row) => ({ ...row }));
}

function activeInCampaign(ownerId: string, campaignId: string): string[] {
  return state.rows
    .filter(
      (row) =>
        row.owner_id === ownerId &&
        row.campaign_id === campaignId &&
        row.is_active
    )
    .map((row) => row.id);
}

describe("addCharacterToCampaign one active character per player", () => {
  it("links inactive first, then swaps to the new active character in one call", async () => {
    seed([
      { id: "old-1", owner_id: "user-A", campaign_id: "camp-1", is_active: true },
      { id: "new-1", owner_id: "user-A", campaign_id: null, is_active: true },
      { id: "other-1", owner_id: "user-B", campaign_id: "camp-1", is_active: true },
    ]);

    await addCharacterToCampaign({
      uid: "user-A",
      characterId: "new-1",
      campaignId: "camp-1",
    });

    expect(activeInCampaign("user-A", "camp-1")).toEqual(["new-1"]);
    // The retired character stays in the campaign, inactive.
    expect(
      state.rows.find((row) => row.id === "old-1")
    ).toMatchObject({ campaign_id: "camp-1", is_active: false });
    // The other player's character is untouched.
    expect(activeInCampaign("user-B", "camp-1")).toEqual(["other-1"]);
    // The swap ran as a single retire-and-activate call.
    expect(state.rpcCalls).toEqual([
      {
        fn: "set_campaign_character_active",
        args: { char_id: "new-1", make_active: true },
      },
    ]);
  });

  it("leaves the old character active when the swap fails", async () => {
    seed([
      { id: "old-1", owner_id: "user-A", campaign_id: "camp-1", is_active: true },
      { id: "new-1", owner_id: "user-A", campaign_id: null, is_active: true },
    ]);
    state.failRpc = true;

    await expect(
      addCharacterToCampaign({
        uid: "user-A",
        characterId: "new-1",
        campaignId: "camp-1",
      })
    ).rejects.toThrow();

    // The link landed inactive, and the old character is still active:
    // the player is never left with none.
    expect(activeInCampaign("user-A", "camp-1")).toEqual(["old-1"]);
    expect(state.rows.find((row) => row.id === "new-1")).toMatchObject({
      campaign_id: "camp-1",
      is_active: false,
    });
  });

  it("links directly as active when the player has no character in the campaign yet", async () => {
    seed([
      { id: "new-1", owner_id: "user-A", campaign_id: null, is_active: true },
    ]);

    await addCharacterToCampaign({
      uid: "user-A",
      characterId: "new-1",
      campaignId: "camp-1",
    });

    expect(activeInCampaign("user-A", "camp-1")).toEqual(["new-1"]);
    expect(
      state.updates.filter((update) => update.values.is_active === false)
    ).toEqual([]);
  });

  it("leaves an already active character alone", async () => {
    seed([
      { id: "new-1", owner_id: "user-A", campaign_id: "camp-1", is_active: true },
    ]);

    await addCharacterToCampaign({
      uid: "user-A",
      characterId: "new-1",
      campaignId: "camp-1",
    });

    expect(activeInCampaign("user-A", "camp-1")).toEqual(["new-1"]);
  });

  it("activates a retired character already in the campaign, retiring the active one", async () => {
    seed([
      { id: "old-1", owner_id: "user-A", campaign_id: "camp-1", is_active: true },
      { id: "new-1", owner_id: "user-A", campaign_id: "camp-1", is_active: false },
    ]);

    await addCharacterToCampaign({
      uid: "user-A",
      characterId: "new-1",
      campaignId: "camp-1",
    });

    expect(activeInCampaign("user-A", "camp-1")).toEqual(["new-1"]);
  });
});
