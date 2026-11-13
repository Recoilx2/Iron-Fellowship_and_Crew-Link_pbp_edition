import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { ensureWorldItemNotes } from "api-calls/world/worldNotes";

vi.mock("config/supabase.config");

// Seam under test: ensureWorldItemNotes insert plumbing. Inserted
// world_notes rows must carry client-generated UUID ids and the call must
// resolve to those ids without a `.select()` on the insert:
// INSERT...RETURNING on world_notes fails RLS because the world_notes
// SELECT policy re-queries its own table (#74).
const state = {
  existingNotes: [] as Array<{ id: string; gm_only: boolean }>,
  insertedNotes: [] as Array<Record<string, unknown>>,
  failInserts: false,
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.existingNotes = [];
  state.insertedNotes = [];
  state.failInserts = false;
  mockedGetSupabaseClient.mockReturnValue({
    from: (table: string) => {
      if (table !== "world_notes") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: async () => ({ data: state.existingNotes, error: null }),
        }),
        // No `.select()` on the insert builder on purpose: the fixed code
        // must not call it (PostgREST would send Prefer:
        // return=representation, which world_notes RLS rejects).
        insert: (row: Record<string, unknown>) => {
          if (state.failInserts) {
            throw new Error("duplicate key value");
          }
          state.insertedNotes.push(row);
          return { error: null };
        },
      };
    },
    // The note-ensure path never touches the other clients.
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("ensureWorldItemNotes insert plumbing", () => {
  it("creates both note rows with client-generated ids and resolves to them", async () => {
    const ids = await ensureWorldItemNotes(
      "world-1",
      "location",
      "location-1"
    );

    expect(state.insertedNotes).toHaveLength(2);
    for (const row of state.insertedNotes) {
      expect(row.id).toMatch(UUID_RE);
      expect(row).toMatchObject({
        world_id: "world-1",
        location_id: "location-1",
      });
    }
    const publicRow = state.insertedNotes.find((row) => !row.gm_only);
    const gmRow = state.insertedNotes.find((row) => row.gm_only);
    expect(ids).toEqual({ publicNoteId: publicRow?.id, gmNoteId: gmRow?.id });
  });

  it("returns existing notes without inserting", async () => {
    state.existingNotes = [
      { id: "public-note", gm_only: false },
      { id: "gm-note", gm_only: true },
    ];

    const ids = await ensureWorldItemNotes(
      "world-1",
      "location",
      "location-1"
    );

    expect(ids).toEqual({ publicNoteId: "public-note", gmNoteId: "gm-note" });
    expect(state.insertedNotes).toHaveLength(0);
  });

  it("falls back to the re-read when a concurrent creator wins the race", async () => {
    state.failInserts = true;
    state.existingNotes = [
      { id: "public-note", gm_only: false },
      { id: "gm-note", gm_only: true },
    ];

    const ids = await ensureWorldItemNotes(
      "world-1",
      "location",
      "location-1"
    );

    expect(ids).toEqual({ publicNoteId: "public-note", gmNoteId: "gm-note" });
  });
});
