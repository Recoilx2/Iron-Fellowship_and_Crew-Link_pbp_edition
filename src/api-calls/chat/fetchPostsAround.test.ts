import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import type { PostRow } from "api-calls/chat/_postRef";
import {
  fetchPostAnchor,
  fetchPostsAround,
} from "api-calls/chat/fetchPostsAround";

vi.mock("config/supabase.config");

const mockedClient = vi.mocked(getSupabaseClient);

const base = Date.parse("2026-11-27T12:00:00.000Z");

function row(n: number, channelId = "channel-1"): PostRow {
  const stamp = new Date(base + n * 1000).toISOString();
  return {
    id: `post-${String(n).padStart(3, "0")}`,
    channel_id: channelId,
    author_id: "player-1",
    speaker_character_id: null,
    speaker_npc_id: null,
    text: `post ${n}`,
    image_paths: [],
    roll: null,
    gms_only: false,
    created_at: stamp,
    updated_at: stamp,
    edited_at: null,
    deleted_at: null,
  };
}

interface CapturedQuery {
  table: string;
  eq: Array<{ column: string; value: unknown }>;
  orExpr?: string;
  orders: Array<{ column: string; ascending: boolean }>;
  limit?: number;
  maybeSingle?: boolean;
}

function setUpClient(
  older: PostRow[],
  newer: PostRow[],
  target: PostRow | null
) {
  const queries: CapturedQuery[] = [];
  mockedClient.mockReturnValue({
    from: (table: string) => {
      const captured: CapturedQuery = { table, eq: [], orders: [] };
      queries.push(captured);
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          captured.eq.push({ column, value });
          return builder;
        },
        or: (expr: string) => {
          captured.orExpr = expr;
          return builder;
        },
        order: (column: string, options?: { ascending: boolean }) => {
          captured.orders.push({ column, ascending: options?.ascending ?? true });
          return builder;
        },
        limit: (n: number) => {
          captured.limit = n;
          return Promise.resolve({
            data: captured.orExpr?.includes("created_at.lt.") ? older : newer,
            error: null,
          });
        },
        maybeSingle: () => {
          captured.maybeSingle = true;
          return Promise.resolve({ data: target, error: null });
        },
      };
      return builder;
    },
  } as never);
  return queries;
}

describe("posts around a jumped-to post", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges older, target and newer posts oldest-first with one deduped target", async () => {
    // Three older rows (one past the window is the lookahead), two newer.
    const older = [row(9), row(8), row(7)];
    const newer = [row(11), row(12)];
    const queries = setUpClient(older, newer, row(10));

    const page = await fetchPostsAround(
      { channelId: "channel-1", id: "post-010", createdAt: row(10).created_at },
      2
    );

    expect(queries).toHaveLength(3);
    expect(queries.every((query) => query.table === "chat_posts")).toBe(true);
    expect(queries[0].eq).toContainEqual({
      column: "channel_id",
      value: "channel-1",
    });
    expect(queries[0].orExpr).toContain("created_at.lt.");
    expect(queries[0].orExpr).toContain("post-010");
    expect(queries[0].orders).toEqual([
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ]);
    expect(queries[0].limit).toBe(3);
    expect(queries[1].orExpr).toContain("created_at.gt.");
    expect(queries[1].orders).toEqual([
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ]);
    expect(queries[1].limit).toBe(2);
    expect(queries[2].eq).toContainEqual({ column: "id", value: "post-010" });
    expect(queries[2].maybeSingle).toBe(true);

    // The lookahead row is held back; the page runs post-008 to post-012.
    expect(page.posts.map((post) => post.id)).toEqual([
      "post-008",
      "post-009",
      "post-010",
      "post-011",
      "post-012",
    ]);
    expect(page.posts.filter((post) => post.id === "post-010")).toHaveLength(1);
    expect(page.hasOlder).toBe(true);
  });

  it("reports no older context at the first post", async () => {
    setUpClient([row(2)], [row(4)], row(3));

    const page = await fetchPostsAround(
      { channelId: "channel-1", id: "post-003", createdAt: row(3).created_at },
      2
    );

    expect(page.posts.map((post) => post.id)).toEqual([
      "post-002",
      "post-003",
      "post-004",
    ]);
    expect(page.hasOlder).toBe(false);
  });

  it("keeps the anchor when its row is no longer readable", async () => {
    setUpClient([], [], null);

    const page = await fetchPostsAround({
      channelId: "channel-1",
      id: "post-010",
      createdAt: row(10).created_at,
    });

    expect(page.posts).toHaveLength(1);
    expect(page.posts[0]).toMatchObject({
      id: "post-010",
      channelId: "channel-1",
    });
    expect(page.posts[0].deletedAt).not.toBeNull();
  });

  it("refuses to jump without a post", async () => {
    setUpClient([], [], null);
    await expect(
      fetchPostsAround({ channelId: "", id: "post-1", createdAt: row(1).created_at })
    ).rejects.toThrow(/channel/i);
  });

  it("passes a query error through", async () => {
    mockedClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            or: () => ({
              order: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({ data: null, error: { message: "no" } }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as never);

    await expect(
      fetchPostsAround({
        channelId: "channel-1",
        id: "post-1",
        createdAt: row(1).created_at,
      })
    ).rejects.toEqual({ message: "no" });
  });
});

describe("email deep-link anchor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a post id to the keyset anchor the store jump needs", async () => {
    const target = row(4);
    const queries = setUpClient([], [], target);

    await expect(fetchPostAnchor(target.id)).resolves.toEqual({
      id: target.id,
      channelId: target.channel_id,
      createdAt: target.created_at,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("chat_posts");
    expect(queries[0].maybeSingle).toBe(true);
    expect(queries[0].eq).toEqual([{ column: "id", value: target.id }]);
  });

  it("returns null when the reader cannot see the post", async () => {
    setUpClient([], [], null);
    await expect(fetchPostAnchor("missing")).resolves.toBeNull();
    await expect(fetchPostAnchor("")).resolves.toBeNull();
  });
});
