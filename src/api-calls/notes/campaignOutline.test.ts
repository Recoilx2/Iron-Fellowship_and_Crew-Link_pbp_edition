import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrCreateCampaignOutline } from "api-calls/notes/campaignOutline";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

// Seam under test: the campaign outline row the Outline tab edits. The
// first GM to open it creates exactly one `outline` row, which is never
// shared; later opens (including a lost insert race against a co-GM)
// return the same row. The access rules behind the row are covered by the
// live tests; here the client is a stub.
const state = {
  existing: null as { id: string } | null,
  inserted: [] as Array<Record<string, unknown>>,
  insertError: null as { code: string } | null,
};

function stubClient() {
  mockedGetSupabaseClient.mockReturnValue({
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: state.existing, error: null }),
          }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return Promise.resolve({
          data: null,
          error: state.insertError,
        });
      },
    })),
  } as unknown as ReturnType<typeof getSupabaseClient>);
}

beforeEach(() => {
  state.existing = null;
  state.inserted = [];
  state.insertError = null;
  stubClient();
});

describe("getOrCreateCampaignOutline", () => {
  it("returns the existing outline without inserting", async () => {
    state.existing = { id: "outline-1" };

    const id = await getOrCreateCampaignOutline({ campaignId: "campaign-1" });

    expect(id).toBe("outline-1");
    expect(state.inserted).toEqual([]);
  });

  it("creates one unshared outline row on first open", async () => {
    const id = await getOrCreateCampaignOutline({ campaignId: "campaign-1" });

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      campaign_id: "campaign-1",
      kind: "outline",
      shared: false,
    });
  });

  it("returns the winner's row when a co-GM wins the creation race", async () => {
    // The partial unique index refuses the second outline insert (23505):
    // re-reading then returns the row the other GM just created.
    state.insertError = { code: "23505" };
    let reads = 0;
    mockedGetSupabaseClient.mockReturnValue({
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => {
                reads += 1;
                return Promise.resolve({
                  data: reads === 1 ? null : { id: "outline-winner" },
                  error: null,
                });
              },
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          state.inserted.push(row);
          return Promise.resolve({ data: null, error: state.insertError });
        },
      })),
    } as unknown as ReturnType<typeof getSupabaseClient>);

    const id = await getOrCreateCampaignOutline({ campaignId: "campaign-1" });

    expect(id).toBe("outline-winner");
    expect(state.inserted).toHaveLength(1);
  });

  it("requires a campaign", async () => {
    await expect(
      getOrCreateCampaignOutline({ campaignId: "  " })
    ).rejects.toBeTruthy();
    expect(state.inserted).toEqual([]);
  });
});
