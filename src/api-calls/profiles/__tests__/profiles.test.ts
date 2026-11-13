import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("config/supabase.config", () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from "config/supabase.config";
import { getProfile } from "api-calls/profiles/getProfile";
import { upsertProfile } from "api-calls/profiles/upsertProfile";

const mockedClient = vi.mocked(getSupabaseClient);

function stubQuery(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single }) });
  const upsert = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select, upsert, update });
  const client = { from };
  mockedClient.mockReturnValue(client as never);
  return { from, select, eq, single, upsert, update };
}

describe("getProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the row keyed to the signed-in person", async () => {
    const { from } = stubQuery({
      data: { id: "user-123", display_name: "Volo" },
      error: null,
    });

    await expect(getProfile({ uid: "user-123" })).resolves.toEqual({
      id: "user-123",
      displayName: "Volo",
    });
    expect(from).toHaveBeenCalledWith("profiles");
  });

  it("returns null when the person has no row yet", async () => {
    stubQuery({ data: null, error: { code: "PGRST116" } });

    await expect(getProfile({ uid: "user-123" })).resolves.toBeNull();
  });
});

describe("upsertProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the person's own display name row", async () => {
    const { upsert } = stubQuery({
      data: { id: "user-123", display_name: "Volo" },
      error: null,
    });

    await expect(
      upsertProfile({ uid: "user-123", displayName: "Volo" })
    ).resolves.toEqual({ id: "user-123", displayName: "Volo" });
    expect(upsert).toHaveBeenCalledWith(
      { id: "user-123", display_name: "Volo" },
      { onConflict: "id" }
    );
  });

  it("rejects with a readable message when the write fails", async () => {
    stubQuery({ data: null, error: new Error("row-level security") });

    await expect(
      upsertProfile({ uid: "user-123", displayName: "Volo" })
    ).rejects.toBe("Failed to save display name.");
  });
});
