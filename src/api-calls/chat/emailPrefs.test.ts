import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import {
  getChannelEmailPreference,
  getGlobalEmailNotifications,
  setChannelEmailPreference,
} from "./emailPrefs";

vi.mock("config/supabase.config");

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

function fakeClient(row: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    upsert: vi.fn(async () => ({ error: null })),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const client = { from: vi.fn(() => chain) };
  mockedGetSupabaseClient.mockReturnValue(client as never);
  return chain;
}

describe("chat email preference wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats a missing global settings row as the migration default (on)", async () => {
    fakeClient(null);
    await expect(getGlobalEmailNotifications({ uid: "u1" })).resolves.toBe(true);
  });

  it("reads an explicit global opt-out", async () => {
    fakeClient({ email_notifications_enabled: false });
    await expect(getGlobalEmailNotifications({ uid: "u1" })).resolves.toBe(false);
  });

  it("treats a missing channel row as no opt-in", async () => {
    fakeClient(null);
    await expect(
      getChannelEmailPreference({ uid: "u1", channelId: "c1" })
    ).resolves.toBeNull();
  });

  it("reads an explicit per-channel opt-in", async () => {
    fakeClient({ opted_in: true });
    await expect(
      getChannelEmailPreference({ uid: "u1", channelId: "c1" })
    ).resolves.toBe(true);
  });

  it("upserts one owner-keyed row for a channel choice", async () => {
    const chain = fakeClient(null);
    await setChannelEmailPreference({
      uid: "u1",
      channelId: "c1",
      optedIn: true,
    });
    expect(chain.upsert).toHaveBeenCalledWith(
      { user_id: "u1", channel_id: "c1", opted_in: true },
      { onConflict: "user_id,channel_id" }
    );
  });
});
