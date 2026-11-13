import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCharacter } from "api-calls/character/createCharacter";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seams under test (pre-agreed with the ticket #63 probe):
// - Seam 1, session identity: after sequential sign-ins on the shared
//   singleton, auth.getUser() follows the LAST sign-in. Not capturable with
//   mocks; covered by the live CI probe (session id vs asserted owner id).
// - Seam 2, owner plumbing (this file): the inserted owner_id must equal the
//   SESSION user's id — the value the characters_insert_own policy compares
//   against auth.uid() — regardless of the caller-supplied uid.
interface CapturedInsert {
  table: string;
  row: Record<string, unknown>;
}

const state = {
  sessionUserId: null as string | null,
  inserted: [] as CapturedInsert[],
};

function sessionValue() {
  return state.sessionUserId
    ? {
        user: { id: state.sessionUserId },
        access_token: `token-for-${state.sessionUserId}`,
      }
    : null;
}

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.sessionUserId = null;
  state.inserted = [];
  mockedGetSupabaseClient.mockReturnValue({
    auth: {
      signInWithPassword: async ({ email }: { email: string }) => {
        state.sessionUserId = email;
        return {
          data: { user: { id: email }, session: sessionValue() },
          error: null,
        };
      },
      getSession: async () => ({
        data: { session: sessionValue() },
        error: null,
      }),
      getUser: async () => ({
        data: {
          user: state.sessionUserId ? { id: state.sessionUserId } : null,
        },
        error: null,
      }),
    },
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        state.inserted.push({ table, row });
        return {
          select: () => ({
            single: async () => ({ data: { id: "char-1" }, error: null }),
          }),
        };
      },
    }),
    // The character insert path never touches the other clients.
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

async function signInAs(userId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.auth.signInWithPassword({
    email: userId,
    password: "password",
  });
  if (error) throw error;
}

describe("createCharacter owner plumbing", () => {
  it("inserts owner_id from the last signed-in session, not a stale caller uid", async () => {
    await signInAs("user-A");
    await signInAs("user-B");

    const sessionUserId = (
      await getSupabaseClient().auth.getUser()
    ).data.user?.id;
    expect(sessionUserId).toBe("user-B");

    await createCharacter({
      uid: "user-A",
      name: "Sheet",
      stats: {},
      assets: [],
    });

    const characterInsert = state.inserted.find(
      (entry) => entry.table === "characters"
    );
    expect(characterInsert?.row.owner_id).toBe("user-B");
  });

  it("creates the character for the signed-in owner on the honest path", async () => {
    await signInAs("user-A");

    const characterId = await createCharacter({
      uid: "user-A",
      name: "Del Nar",
      stats: { edge: 2 },
      assets: [],
    });

    const inserted = state.inserted.find(
      (entry) => entry.table === "characters"
    )?.row;
    expect(characterId).toBe(inserted?.id);
    expect(inserted).toMatchObject({ owner_id: "user-A", name: "Del Nar" });
  });

  it("resolves the client-generated id carried by the inserted row", async () => {
    await signInAs("user-A");

    const characterId = await createCharacter({
      uid: "user-A",
      name: "Sheet",
      stats: {},
      assets: [],
    });

    const characterInsert = state.inserted.find(
      (entry) => entry.table === "characters"
    );
    expect(characterInsert?.row.id).toBe(characterId);
    expect(characterId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("refuses to create when nobody is signed in instead of hitting RLS", async () => {
    await expect(
      createCharacter({
        uid: "user-A",
        name: "Ghost",
        stats: {},
        assets: [],
      })
    ).rejects.toBeTruthy();
    expect(
      state.inserted.filter((entry) => entry.table === "characters")
    ).toEqual([]);
  });
});
