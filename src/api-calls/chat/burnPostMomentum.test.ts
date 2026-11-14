import { describe, expect, it, vi, beforeEach } from "vitest";

import { burnPostMomentum } from "api-calls/chat/burnPostMomentum";
import { getSupabaseClient } from "config/supabase.config";
import { ROLL_RESULT, ROLL_TYPE } from "types/DieRolls.type";

vi.mock("config/supabase.config");

const mockedClient = vi.mocked(getSupabaseClient);

function statJson(overrides: Record<string, unknown> = {}) {
  return {
    type: ROLL_TYPE.STAT,
    rollLabel: "Edge",
    action: 2,
    challenge1: 3,
    challenge2: 8,
    result: ROLL_RESULT.MISS,
    timestamp: "2026-11-13T12:00:00.000Z",
    characterId: "kira",
    uid: "player-1",
    gmsOnly: false,
    ...overrides,
  };
}

// Seam under test: the posted-roll burn wrapper. It reuses the sheet's burn
// rule, records the burn with the recalculated outcome, and resets the
// character's momentum the same way as a sheet burn. The database lock
// behind the roll update is covered by the live access-rule tests; here the
// client is a stub with known-good dice.
function setUpClient(options: {
  post?: Record<string, unknown> | null;
  character?: Record<string, unknown> | null;
  sessionUser?: string;
} = {}) {
  const post =
    options.post === undefined
      ? {
          id: "post-1",
          author_id: "player-1",
          speaker_character_id: "kira",
          speaker_npc_id: null,
          deleted_at: null,
          roll: statJson(),
          gms_only: false,
        }
      : options.post;
  const character =
    options.character === undefined
      ? { id: "kira", owner_id: "player-1", momentum: 5, debilities: {} }
      : options.character;
  const updates: Array<{ table: string; payload: Record<string, unknown> }> =
    [];
  const client = {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { id: options.sessionUser ?? "player-1" } } },
          error: null,
        }),
    },
    from: (table: string) => {
      if (table === "chat_posts") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve(
                  post
                    ? { data: post, error: null }
                    : { data: null, error: new Error("not found") }
                ),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push({ table, payload });
            return {
              eq: () => ({
                select: () =>
                  Promise.resolve({ data: [{ id: "post-1" }], error: null }),
              }),
            };
          },
        };
      }
      if (table === "characters") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve(
                  character
                    ? { data: character, error: null }
                    : { data: null, error: new Error("not found") }
                ),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push({ table, payload });
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  mockedClient.mockReturnValue(client as never);
  return { updates };
}

describe("burnPostMomentum", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("records the burn with the recalculated outcome and leaves the reset to the database", async () => {
    const { updates } = setUpClient();
    await burnPostMomentum({ postId: "post-1" });
    const rollUpdate = updates.find((u) => u.table === "chat_posts");
    expect(rollUpdate?.payload.roll).toMatchObject({
      momentumBurned: 5,
      result: ROLL_RESULT.WEAK_HIT,
      action: 2,
      challenge1: 3,
      challenge2: 8,
    });
    // One update only: the database's burn trigger resets the character's
    // momentum in the same transaction, so the wrapper never writes the
    // character and a failed second request cannot strand a burn unspent.
    // The atomic reset is covered by the live access-rule tests.
    expect(updates).toHaveLength(1);
  });

  it("refuses a second burn", async () => {
    setUpClient({
      post: {
        id: "post-1",
        author_id: "player-1",
        speaker_character_id: "kira",
        speaker_npc_id: null,
        deleted_at: null,
        roll: statJson({ momentumBurned: 5, result: ROLL_RESULT.WEAK_HIT }),
        gms_only: false,
      },
    });
    await expect(burnPostMomentum({ postId: "post-1" })).rejects.toThrow(
      /already burned/i
    );
  });

  it("refuses burns on NPC and GM-self voices", async () => {
    setUpClient({
      sessionUser: "gm-1",
      post: {
        id: "post-1",
        author_id: "gm-1",
        speaker_character_id: null,
        speaker_npc_id: "elder",
        deleted_at: null,
        roll: statJson({ characterId: null, uid: "gm-1" }),
        gms_only: false,
      },
    });
    await expect(burnPostMomentum({ postId: "post-1" })).rejects.toThrow(
      /own character/i
    );
  });

  it("refuses burns on deleted posts", async () => {
    setUpClient({
      post: {
        id: "post-1",
        author_id: "player-1",
        speaker_character_id: "kira",
        speaker_npc_id: null,
        deleted_at: "2026-11-13T13:00:00.000Z",
        roll: statJson(),
        gms_only: false,
      },
    });
    await expect(burnPostMomentum({ postId: "post-1" })).rejects.toThrow(
      /deleted/i
    );
  });
});
