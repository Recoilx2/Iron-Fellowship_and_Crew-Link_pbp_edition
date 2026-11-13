import { beforeEach, describe, expect, it, vi } from "vitest";

import { addNote } from "api-calls/notes/addNote";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

// Seam under test: the note id the caller gets back is the id carried by
// the inserted row. The notes SELECT policy re-queries its own table, so a
// just-inserted row is invisible to the same-statement RETURNING check and
// insert-then-select fails RLS (#69). The insert must therefore carry a
// client-generated id and skip RETURNING entirely.
interface CapturedInsert {
  table: string;
  row: Record<string, unknown>;
}

const state = {
  inserted: [] as CapturedInsert[],
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.inserted = [];
  mockedGetSupabaseClient.mockReturnValue({
    from: (table: string) => ({
      // No .select() chain: code under test must not ask for RETURNING.
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push({ table, row });
        return { data: null, error: null };
      },
    }),
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("addNote id plumbing", () => {
  it("resolves the client-generated id carried by the inserted row", async () => {
    const noteId = await addNote({ characterId: "char-1", order: 0 });

    const noteInsert = state.inserted.find(
      (entry) => entry.table === "character_notes"
    );
    expect(noteInsert?.row.id).toBe(noteId);
    expect(noteId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
