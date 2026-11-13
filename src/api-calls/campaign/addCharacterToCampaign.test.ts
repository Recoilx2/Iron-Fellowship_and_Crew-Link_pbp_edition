import { beforeEach, describe, expect, it, vi } from "vitest";

import { addCharacterToCampaign } from "api-calls/campaign/addCharacterToCampaign";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: adding a character to a campaign where the player already
// plays one swaps the old character out instead of issuing a bare link the
// one-character-per-player guard (#109) would reject.
interface CharacterRow {
  id: string;
  owner_id: string;
  campaign_id: string | null;
}

const state = {
  sessionUserId: "user-A",
  rows: [] as CharacterRow[],
  updates: [] as Array<{ values: Record<string, unknown>; id: string }>,
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
            if (row && "campaign_id" in values) {
              row.campaign_id = values.campaign_id as string | null;
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
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

function seed(rows: CharacterRow[]): void {
  state.rows = rows.map((row) => ({ ...row }));
}

function inCampaign(ownerId: string, campaignId: string): CharacterRow[] {
  return state.rows.filter(
    (row) => row.owner_id === ownerId && row.campaign_id === campaignId
  );
}

describe("addCharacterToCampaign one character per player", () => {
  it("swaps the old character out instead of adding a second one", async () => {
    seed([
      { id: "old-1", owner_id: "user-A", campaign_id: "camp-1" },
      { id: "new-1", owner_id: "user-A", campaign_id: null },
      { id: "other-1", owner_id: "user-B", campaign_id: "camp-1" },
    ]);

    await addCharacterToCampaign({
      uid: "user-A",
      characterId: "new-1",
      campaignId: "camp-1",
    });

    expect(inCampaign("user-A", "camp-1").map((row) => row.id)).toEqual([
      "new-1",
    ]);
    // The other player's character is untouched.
    expect(inCampaign("user-B", "camp-1").map((row) => row.id)).toEqual([
      "other-1",
    ]);
  });

  it("links directly when the player has no character in the campaign yet", async () => {
    seed([{ id: "new-1", owner_id: "user-A", campaign_id: null }]);

    await addCharacterToCampaign({
      uid: "user-A",
      characterId: "new-1",
      campaignId: "camp-1",
    });

    expect(inCampaign("user-A", "camp-1").map((row) => row.id)).toEqual([
      "new-1",
    ]);
    expect(
      state.updates.filter((update) => update.values.campaign_id === null)
    ).toEqual([]);
  });

  it("leaves the character alone when it is already the campaign character", async () => {
    seed([{ id: "new-1", owner_id: "user-A", campaign_id: "camp-1" }]);

    await addCharacterToCampaign({
      uid: "user-A",
      characterId: "new-1",
      campaignId: "camp-1",
    });

    expect(inCampaign("user-A", "camp-1").map((row) => row.id)).toEqual([
      "new-1",
    ]);
  });
});
