import { describe, expect, it, vi, beforeEach } from "vitest";

import { editPost } from "api-calls/chat/editPost";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedClient = vi.mocked(getSupabaseClient);

// Seam under test: the edit wrapper keeps the spec invariant (text, images
// or a roll) client-side. Text-only posts still need words; a post that
// retains images or a roll may clear its text, and the database keeps the
// final word. The access rules behind the update are covered by the live
// tests; here the client is a stub.
function setUpClient(row: {
  id: string;
  image_paths: string[];
  roll: unknown | null;
} | null) {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from: (table: string) => {
      if (table !== "chat_posts") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve(
                row
                  ? { data: row, error: null }
                  : { data: null, error: new Error("not found") }
              ),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return {
            eq: () => ({
              select: () =>
                Promise.resolve({ data: [{ id: "post-1" }], error: null }),
            }),
          };
        },
      };
    },
  };
  mockedClient.mockReturnValue(client as never);
  return { updates };
}

describe("editPost", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("edits the text of a text-only post", async () => {
    const { updates } = setUpClient({
      id: "post-1",
      image_paths: [],
      roll: null,
    });
    await editPost({ postId: "post-1", text: "  fixed  " });
    expect(updates).toEqual([{ text: "fixed" }]);
  });

  it("still requires text on a text-only post", async () => {
    setUpClient({ id: "post-1", image_paths: [], roll: null });
    await expect(editPost({ postId: "post-1", text: "   " })).rejects.toThrow(
      /text/i
    );
  });

  it("lets a roll post clear its text", async () => {
    const { updates } = setUpClient({
      id: "post-1",
      image_paths: [],
      roll: { type: 0 },
    });
    await editPost({ postId: "post-1", text: "   " });
    expect(updates).toEqual([{ text: "" }]);
  });

  it("lets an image post clear its text", async () => {
    const { updates } = setUpClient({
      id: "post-1",
      image_paths: ["campaign-1/post-1/lantern.png"],
      roll: null,
    });
    await editPost({ postId: "post-1", text: "" });
    expect(updates).toEqual([{ text: "" }]);
  });
});
