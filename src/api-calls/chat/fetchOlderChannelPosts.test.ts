import { describe, expect, it, vi } from "vitest";

import { fetchOlderChannelPosts } from "api-calls/chat/fetchOlderChannelPosts";
import { CHAT_POST_PAGE_SIZE } from "api-calls/chat/listenToChannelPosts";
import type { PostRow } from "api-calls/chat/_postRef";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedClient = vi.mocked(getSupabaseClient);

// Seam under test: the one-off older-posts page. The live feed stays on the
// latest page, so scrolling back fetches strictly older rows with a
// (created_at, id) cursor and a one-row lookahead for the has-older flag,
// newest-first from the database and oldest-first to the reader.
function newestFirst(count: number, start = 0): PostRow[] {
  const base = Date.parse("2026-11-13T12:00:00.000Z");
  return Array.from({ length: count }, (_, i) => {
    const n = start + count - 1 - i;
    const stamp = new Date(base + n * 1000).toISOString();
    return {
      id: `post-${String(n).padStart(3, "0")}`,
      channel_id: "channel-1",
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
  });
}

interface CapturedQuery {
  table: string;
  selected: string;
  eq: Array<{ column: string; value: unknown }>;
  orExpr?: string;
  orders: Array<{ column: string; ascending: boolean }>;
  limit?: number;
}

function setUpClient(rows: PostRow[]) {
  const captured: CapturedQuery = {
    table: "",
    selected: "",
    eq: [],
    orders: [],
  };
  const terminal = {
    limit: (n: number) => {
      captured.limit = n;
      return Promise.resolve({ data: rows.slice(0, n), error: null });
    },
  };
  const secondOrder = {
    order: (column: string, options?: { ascending: boolean }) => {
      captured.orders.push({ column, ascending: options?.ascending ?? true });
      return terminal;
    },
  };
  const firstOrder = {
    order: (column: string, options?: { ascending: boolean }) => {
      captured.orders.push({ column, ascending: options?.ascending ?? true });
      return secondOrder;
    },
  };
  const withOr = {
    or: (expr: string) => {
      captured.orExpr = expr;
      return firstOrder;
    },
  };
  const withEq = {
    eq: (column: string, value: unknown) => {
      captured.eq.push({ column, value });
      return withOr;
    },
  };
  mockedClient.mockReturnValue({
    from: (table: string) => {
      captured.table = table;
      return {
        select: (columns: string) => {
          captured.selected = columns;
          return withEq;
        },
      };
    },
  } as never);
  return captured;
}

describe("older posts page", () => {
  it("fetches strictly older rows and returns them oldest-first", async () => {
    const cursor = {
      createdAt: "2026-11-13T12:00:30.000Z",
      id: "post-030",
    };
    // One row past the page: the lookahead the flag is read from.
    const captured = setUpClient(newestFirst(CHAT_POST_PAGE_SIZE + 1, 0));

    const page = await fetchOlderChannelPosts("channel-1", cursor);

    expect(captured.table).toBe("chat_posts");
    expect(captured.eq).toContainEqual({
      column: "channel_id",
      value: "channel-1",
    });
    expect(captured.orExpr).toContain("post-030");
    expect(captured.orExpr).toContain("2026-11-13T12:00:30.000Z");
    expect(captured.orders).toEqual([
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ]);
    expect(captured.limit).toBe(CHAT_POST_PAGE_SIZE + 1);
    expect(page.posts).toHaveLength(CHAT_POST_PAGE_SIZE);
    // The lookahead row is the oldest one held back, so the page runs from
    // the row after it up to the cursor.
    expect(page.posts[0].id).toBe("post-001");
    expect(page.posts[page.posts.length - 1].id).toBe("post-030");
    expect(page.hasOlder).toBe(true);
  });

  it("reports no older posts at the channel's first post", async () => {
    const captured = setUpClient(newestFirst(3, 0));
    void captured;

    const page = await fetchOlderChannelPosts(
      "channel-1",
      { createdAt: "2026-11-13T12:00:30.000Z", id: "post-030" },
      10
    );

    expect(page.posts).toHaveLength(3);
    expect(page.hasOlder).toBe(false);
  });

  it("refuses to page without a channel", async () => {
    setUpClient([]);
    await expect(
      fetchOlderChannelPosts("", {
        createdAt: "2026-11-13T12:00:30.000Z",
        id: "post-030",
      })
    ).rejects.toBeTruthy();
  });
});
