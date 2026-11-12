import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("config/supabase.config", () => ({
  getSupabaseClient: vi.fn(),
}));
vi.mock("api-calls/profiles/upsertProfile", () => ({
  upsertProfile: vi.fn(),
}));
vi.mock("api-calls/user/updateUserDoc", () => ({
  updateUserDoc: vi.fn(),
}));

import { getSupabaseClient } from "config/supabase.config";
import { upsertProfile } from "api-calls/profiles/upsertProfile";
import { updateUserDoc } from "api-calls/user/updateUserDoc";
import { updateUser } from "api-calls/auth/updateUser";

const mockedClient = vi.mocked(getSupabaseClient);
const mockedUpsert = vi.mocked(upsertProfile);
const mockedLegacyUpdate = vi.mocked(updateUserDoc);

function stubSession(userId: string | null) {
  const updateAuthUser = vi.fn().mockResolvedValue({ error: null });
  mockedClient.mockReturnValue({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: userId ? { user: { id: userId } } : null },
        error: null,
      }),
      updateUser: updateAuthUser,
    },
  } as never);
  mockedUpsert.mockResolvedValue({ id: userId ?? "", displayName: "Volo" });
  mockedLegacyUpdate.mockResolvedValue(undefined);
  return { updateAuthUser };
}

describe("updateUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the display name to the person's profile", async () => {
    stubSession("user-123");

    await updateUser({ displayName: "Volo" });
    expect(mockedUpsert).toHaveBeenCalledWith({
      uid: "user-123",
      displayName: "Volo",
    });
  });

  it("keeps the auth user's metadata in sync", async () => {
    const { updateAuthUser } = stubSession("user-123");

    await updateUser({ displayName: "Volo" });
    expect(updateAuthUser).toHaveBeenCalledWith({
      data: { display_name: "Volo" },
    });
  });

  it("keeps the legacy user document in sync", async () => {
    stubSession("user-123");

    await updateUser({ displayName: "Volo", hidePhoto: true });
    expect(mockedLegacyUpdate).toHaveBeenCalledWith({
      uid: "user-123",
      user: { displayName: "Volo", hidePhoto: true },
    });
  });

  it("rejects when nobody is signed in", async () => {
    stubSession(null);

    await expect(updateUser({ displayName: "Volo" })).rejects.toBe(
      "User is not signed in."
    );
    expect(mockedUpsert).not.toHaveBeenCalled();
  });
});
