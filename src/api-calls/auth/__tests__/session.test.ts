import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("config/supabase.config", () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from "config/supabase.config";
import { getUser } from "api-calls/auth/getUser";
import { listenToAuthState } from "api-calls/auth/listenToAuthState";
import { logout } from "api-calls/auth/logout";

const mockedClient = vi.mocked(getSupabaseClient);

const supabaseUser = {
  id: "user-123",
  email: "player@example.com",
  user_metadata: { display_name: "Volo" },
  app_metadata: {},
  aud: "authenticated",
  created_at: "2026-11-12T00:00:00Z",
};

function stubClient(authOverrides = {}) {
  const auth = {
    getSession: vi
      .fn()
      .mockResolvedValue({ data: { session: null }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
    ...authOverrides,
  };
  const client = { auth };
  mockedClient.mockReturnValue(client as never);
  return { auth, client };
}

describe("getUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the signed-in person as an app user", async () => {
    stubClient({
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: supabaseUser } },
        error: null,
      }),
    });

    await expect(getUser()).resolves.toEqual({
      uid: "user-123",
      displayName: "Volo",
      email: "player@example.com",
      photoURL: null,
    });
  });

  it("returns null when nobody is signed in", async () => {
    stubClient();

    await expect(getUser()).resolves.toBeNull();
  });
});

describe("listenToAuthState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps session users to app users", () => {
    let listener!: (
      event: string,
      session: { user: typeof supabaseUser } | null
    ) => void;
    stubClient({
      onAuthStateChange: vi.fn((cb: typeof listener) => {
        listener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    });

    const onUser = vi.fn();
    listenToAuthState({ onUser });
    listener("SIGNED_IN", { user: supabaseUser });
    expect(onUser).toHaveBeenCalledWith({
      uid: "user-123",
      displayName: "Volo",
      email: "player@example.com",
      photoURL: null,
    });
    listener("SIGNED_OUT", null);
    expect(onUser).toHaveBeenCalledWith(null);
  });

  it("returns a plain unsubscribe function", () => {
    const unsubscribe = vi.fn();
    stubClient({
      onAuthStateChange: vi
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe } } }),
    });

    const stop = listenToAuthState({ onUser: () => {} });
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe("logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs out, ending the persisted session", async () => {
    const { auth } = stubClient();

    await logout();
    expect(auth.signOut).toHaveBeenCalled();
  });
});
