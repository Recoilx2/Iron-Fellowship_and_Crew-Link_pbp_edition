import { beforeEach, describe, expect, it, vi } from "vitest";

import { addCharacterToCampaign } from "api-calls/campaign/addCharacterToCampaign";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: adding a character to a campaign where the player
// already plays one. At most one character per player per campaign is
// active (#127): linking another retires the current active one first and
// links the new one active, so the database guard never sees two actives.
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
  it("retires the current active character and links the new one active", async () => {
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

  it("activates a retired character already in the campaign, retiring the current one", async () => {
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
