import { describe, expect, it, vi, beforeEach } from "vitest";

import { deletePost } from "api-calls/chat/deletePost";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedClient = vi.mocked(getSupabaseClient);

// Seam under test: the delete wrapper. A soft delete clears the row and
// removes the post's image files while the row still names them (the
// storage rules attribute a file to its post, so files must go before the
// row is cleared). The database rules behind the row update are covered by
// the live access-rule tests; here the client is a stub.
function setUpClient(row: { id: string; image_paths: string[] } | null) {
  const calls: string[] = [];
  let updatePayload: Record<string, unknown> | null = null;
  const removedPaths: string[][] = [];
  const client = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      return {
        select: (columns?: string) => {
          calls.push(`select:${columns ?? "*"}`);
          return {
            eq: (column: string, value: unknown) => {
              calls.push(`eq:${column}=${value}`);
              return {
                single: () =>
                  Promise.resolve(
                    row
                      ? { data: row, error: null }
                      : { data: null, error: new Error("denied") }
                  ),
              };
            },
          };
        },
        update: (payload: Record<string, unknown>) => {
          calls.push("update");
          updatePayload = payload;
          return {
            eq: (column: string, value: unknown) => {
              calls.push(`eq:${column}=${value}`);
              return {
                select: (columns?: string) => {
                  calls.push(`select:${columns ?? "*"}`);
                  return Promise.resolve({
                    data: [{ id: "post-1" }],
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
    storage: {
      from: (bucket: string) => {
        calls.push(`storage:${bucket}`);
        return {
          remove: (paths: string[]) => {
            calls.push(`remove:${paths.join(",")}`);
            removedPaths.push(paths);
            return Promise.resolve({ data: paths, error: null });
          },
        };
      },
    },
  };
  mockedClient.mockReturnValue(client as never);
  return {
    calls,
    updatePayload: () => updatePayload,
    removedPaths: () => removedPaths,
  };
}

describe("deletePost", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("clears the text, image paths and roll with a delete marker", async () => {
    const harness = setUpClient({ id: "post-1", image_paths: [] });

    await deletePost({ postId: "post-1" });

    expect(harness.updatePayload()).toMatchObject({
      text: "",
      image_paths: [],
      roll: null,
    });
    expect(
      typeof (harness.updatePayload() as Record<string, unknown>)?.deleted_at
    ).toBe("string");
  });

  it("removes the post's image files before clearing the row", async () => {
    const paths = ["campaign-1/post-1/lantern.png", "campaign-1/post-1/map.png"];
    const harness = setUpClient({ id: "post-1", image_paths: paths });

    await deletePost({ postId: "post-1" });

    expect(harness.removedPaths().flat()).toEqual(paths);
    const removeIndex = harness.calls.findIndex((call) =>
      call.startsWith("remove:")
    );
    const updateIndex = harness.calls.findIndex((call) => call === "update");
    expect(removeIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(removeIndex).toBeLessThan(updateIndex);
  });

  it("rejects a post nobody can read without touching storage", async () => {
    const harness = setUpClient(null);

    await expect(deletePost({ postId: "post-1" })).rejects.toThrow(/denied/i);
    expect(harness.calls.some((call) => call.startsWith("remove:"))).toBe(
      false
    );
    expect(harness.calls.some((call) => call === "update")).toBe(false);
  });
});
