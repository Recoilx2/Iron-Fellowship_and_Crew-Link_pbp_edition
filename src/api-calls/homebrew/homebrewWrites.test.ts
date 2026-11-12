import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// The toast has no provider outside React, so it would throw and swallow the
// rejection under test (see #51). Neutralize it: these tests assert the
// rejection itself, not the toast.
vi.mock("providers/SnackbarProvider/useSnackbar", () => ({
  createErrorSnackbar: vi.fn(),
  createInfoSnackbar: vi.fn(),
  createSuccessSnackbar: vi.fn(),
  createWarningSnackbar: vi.fn(),
  useSnackbar: () => ({}),
}));

import {
  createHomebrewContentApi,
  modifyContentData,
} from "api-calls/homebrew/_supabase";
import { updateHomebrewExpansion } from "api-calls/homebrew/updateHomebrewExpansion";
import { deleteHomebrewExpansion } from "api-calls/homebrew/deleteHomebrewExpansion";

const existingRow = {
  id: "row-id",
  collection_id: "collection-id",
  data: { label: "Mine" },
  updated_at: "2026-01-01T00:00:00Z",
};

/**
 * Stands in for PostgREST under row-level security: reads stay public, so
 * the read returns the row, but an outsider's write matches zero rows and
 * PostgREST answers success with an empty payload (`data` holds the
 * returning rows, `[]` when nothing was written).
 */
function stubClient(written: Array<{ id: string }>): SupabaseClient {
  const chainable = (result: unknown) => {
    const chain = {
      select: (): unknown => chain,
      eq: (): unknown => chain,
      single: (): unknown => chain,
      then: (resolve: (value: unknown) => void): void => {
        resolve(result);
      },
    };
    return chain;
  };
  const read = chainable({ data: existingRow, error: null });
  const write = chainable({ data: written, error: null });
  return {
    from: () => ({
      select: () => read,
      update: () => write,
      delete: () => write,
    }),
  } as unknown as SupabaseClient;
}

const api = createHomebrewContentApi<{
  collectionId: string;
  label?: string;
}>("homebrew_stats");

describe("homebrew write helpers", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a content update that matches no rows", async () => {
    const client = stubClient([]);
    await expect(
      api.update({ id: "row-id", doc: { label: "Hijacked" }, client })
    ).rejects.toThrow();
  });

  it("resolves a content update that writes a row", async () => {
    const client = stubClient([{ id: "row-id" }]);
    await expect(
      api.update({ id: "row-id", doc: { label: "Mine" }, client })
    ).resolves.toBeUndefined();
  });

  it("rejects a content delete that matches no rows", async () => {
    const client = stubClient([]);
    await expect(api.remove({ id: "row-id", client })).rejects.toThrow();
  });

  it("resolves a content delete that writes a row", async () => {
    const client = stubClient([{ id: "row-id" }]);
    await expect(api.remove({ id: "row-id", client })).resolves.toBeUndefined();
  });

  it("rejects a nested content write that matches no rows", async () => {
    const client = stubClient([]);
    await expect(
      modifyContentData(
        "homebrew_impact_categories",
        "row-id",
        (data) => {
          data.contents = {};
        },
        { client }
      )
    ).rejects.toThrow();
  });

  it("resolves a nested content write that writes a row", async () => {
    const client = stubClient([{ id: "row-id" }]);
    await expect(
      modifyContentData(
        "homebrew_impact_categories",
        "row-id",
        (data) => {
          data.contents = {};
        },
        { client }
      )
    ).resolves.toBeUndefined();
  });

  it("rejects a collection update that matches no rows", async () => {
    const client = stubClient([]);
    await expect(
      updateHomebrewExpansion({
        id: "collection-id",
        expansion: { title: "Hijacked" },
        client,
      })
    ).rejects.toThrow();
  });

  it("resolves a collection update that writes a row", async () => {
    const client = stubClient([{ id: "collection-id" }]);
    await expect(
      updateHomebrewExpansion({
        id: "collection-id",
        expansion: { title: "Renamed" },
        client,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects a collection delete that matches no rows", async () => {
    const client = stubClient([]);
    await expect(
      deleteHomebrewExpansion({ id: "collection-id", client })
    ).rejects.toThrow();
  });

  it("resolves a collection delete that writes a row", async () => {
    const client = stubClient([{ id: "collection-id" }]);
    await expect(
      deleteHomebrewExpansion({ id: "collection-id", client })
    ).resolves.toBeUndefined();
  });
});
