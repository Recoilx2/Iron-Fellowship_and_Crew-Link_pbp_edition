import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("config/supabase.config", () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from "config/supabase.config";
import { sendMagicEmailLink } from "api-calls/auth/sendMagicEmailLink";

const mockedClient = vi.mocked(getSupabaseClient);

function stubClient(authOverrides = {}) {
  const auth = {
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    ...authOverrides,
  };
  const client = { auth };
  mockedClient.mockReturnValue(client as never);
  return { auth, client };
}

describe("sendMagicEmailLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:5173" },
    });
  });

  it("sends a magic link to the email, returning to this site", async () => {
    const { auth } = stubClient();

    await expect(
      sendMagicEmailLink({ email: "player@example.com" })
    ).resolves.toBe(true);
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "player@example.com",
      options: {
        emailRedirectTo: "http://localhost:5173",
        data: {},
      },
    });
  });

  it("carries the signup display name in the auth user metadata", async () => {
    const { auth } = stubClient();

    await sendMagicEmailLink({ email: "player@example.com", name: "Volo" });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "player@example.com",
      options: {
        emailRedirectTo: "http://localhost:5173",
        data: { display_name: "Volo" },
      },
    });
  });

  it("rejects with a readable message when the mailer fails", async () => {
    stubClient({
      signInWithOtp: vi
        .fn()
        .mockResolvedValue({ error: new Error("smtp refused") }),
    });

    await expect(
      sendMagicEmailLink({ email: "player@example.com" })
    ).rejects.toBe("Failed to send sign-in email.");
  });
});
