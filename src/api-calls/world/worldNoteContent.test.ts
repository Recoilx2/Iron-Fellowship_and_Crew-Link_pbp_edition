import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { writeWorldNoteContent } from "api-calls/world/worldNotes";

vi.mock("config/supabase.config");

// Seam under test: the note-contents upsert matched-row contract. An
// upsert that matches no row (a player's write is filtered out by RLS)
// must reject instead of resolving silently. The note rows already exist
// here, so the ensure path only reads.
const state = {
  existingNotes: [] as Array<{ id: string; gm_only: boolean }>,
  upsertedRows: [] as Array<{ note_id: string }>,
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.existingNotes = [
    { id: "public-note", gm_only: false },
    { id: "gm-note", gm_only: true },
  ];
  state.upsertedRows = [{ note_id: "gm-note" }];
  mockedGetSupabaseClient.mockReturnValue({
    from: (table: string) => {
      if (table === "world_notes") {
        return {
          select: () => ({
            eq: async () => ({ data: state.existingNotes, error: null }),
          }),
        };
      }
      if (table === "world_note_contents") {
        return {
          upsert: () => ({
            // The fixed code chains `.select()` onto the upsert (the #69
            // pattern) so an RLS-filtered write returns no rows.
            select: async () => ({ data: state.upsertedRows, error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("writeWorldNoteContent matched-row contract", () => {
  it("resolves when the upsert matches the note row", async () => {
    await expect(
      writeWorldNoteContent(
        "world-1",
        "location",
        "location-1",
        true,
        new Uint8Array([1, 2, 3])
      )
    ).resolves.toBeUndefined();
  });

  it("rejects when the upsert matches no row", async () => {
    state.upsertedRows = [];
    await expect(
      writeWorldNoteContent(
        "world-1",
        "location",
        "location-1",
        true,
        new Uint8Array([9, 9, 9])
      )
    ).rejects.toBeTruthy();
  });
});
