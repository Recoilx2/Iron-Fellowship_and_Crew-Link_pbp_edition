import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { updateCampaignHiddenAssets } from "api-calls/campaign/updateHiddenAssets";
import { updateCampaignHiddenOracles } from "api-calls/campaign/updateHiddenOracles";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seams under test: the two hidden-list writers. They read the campaign row
// first (members-only SELECT), then write the toggled list back. Where that
// write matches zero rows, PostgREST answers success with an empty payload —
// the #69/#82/#91 trap — so the writer must chain `.select("id")` and reject
// on empty instead of resolving silently. These tests assert that contract:
// a matched write resolves, an empty write rejects. They catch silent
// no-ops; actual policy behavior stays with the live tests.
const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

interface StubOptions {
  row: Record<string, unknown>;
  written: Array<{ id: string }>;
  updateReturning: boolean[];
}

/**
 * Stands in for PostgREST under row-level security: the read returns the
 * campaign row, and the write returns `written` only when the update asked
 * for RETURNING rows (`.select(...)` chained); without it PostgREST answers
 * success with no payload, which is exactly what hides an RLS no-op.
 */
function stubClient(options: StubOptions): SupabaseClient {
  const { row, written, updateReturning } = options;
  const read = {
    select: () => read,
    eq: () => read,
    single: () => read,
    then: (resolve: (value: unknown) => void): void => {
      resolve({ data: row, error: null });
    },
  };
  const write = {
    eq: () => write,
    select: () => {
      updateReturning.push(true);
      return write;
    },
    then: (resolve: (value: unknown) => void): void => {
      resolve(
        updateReturning.length > 0
          ? { data: written, error: null }
          : { data: null, error: null }
      );
    },
  };
  return {
    from: () => ({
      select: () => read,
      update: () => write,
    }),
  } as unknown as SupabaseClient;
}

function mockClient(
  row: Record<string, unknown>,
  written: Array<{ id: string }>
): boolean[] {
  const updateReturning: boolean[] = [];
  mockedGetSupabaseClient.mockReturnValue(
    stubClient({ row, written, updateReturning })
  );
  return updateReturning;
}

describe("hidden-list writers", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("resolves hiding an asset when the write matches the row", async () => {
    mockClient({ hidden_asset_ids: [] }, [{ id: "campaign-1" }]);
    await expect(
      updateCampaignHiddenAssets({
        campaignId: "campaign-1",
        assetId: "asset-1",
        isHidden: true,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects hiding an asset when the write matches no rows", async () => {
    mockClient({ hidden_asset_ids: [] }, []);
    await expect(
      updateCampaignHiddenAssets({
        campaignId: "campaign-1",
        assetId: "asset-1",
        isHidden: true,
      })
    ).rejects.toThrow();
  });

  it("resolves hiding an oracle when the write matches the row", async () => {
    mockClient({ hidden_oracle_ids: [] }, [{ id: "campaign-1" }]);
    await expect(
      updateCampaignHiddenOracles({
        campaignId: "campaign-1",
        oracleId: "oracle-1",
        hidden: true,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects hiding an oracle when the write matches no rows", async () => {
    mockClient({ hidden_oracle_ids: [] }, []);
    await expect(
      updateCampaignHiddenOracles({
        campaignId: "campaign-1",
        oracleId: "oracle-1",
        hidden: true,
      })
    ).rejects.toThrow();
  });
});
