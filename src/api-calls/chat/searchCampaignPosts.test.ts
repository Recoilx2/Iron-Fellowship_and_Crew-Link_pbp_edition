import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import type { PostRow } from "api-calls/chat/_postRef";
import {
  CHAT_SEARCH_PAGE_SIZE,
  searchCampaignPosts,
} from "api-calls/chat/searchCampaignPosts";
import { ROLL_RESULT, ROLL_TYPE } from "types/DieRolls.type";

vi.mock("config/supabase.config");

const mockedClient = vi.mocked(getSupabaseClient);

function row(id: string, secondsAgo: number, text: string): PostRow {
  const stamp = new Date(Date.parse("2026-11-27T12:00:00.000Z") - secondsAgo * 1000).toISOString();
  return {
    id,
    channel_id: "channel-1",
    author_id: "player-1",
    speaker_character_id: null,
    speaker_npc_id: null,
    text,
    image_paths: [],
    roll: null,
    gms_only: false,
    created_at: stamp,
    updated_at: stamp,
    edited_at: null,
    deleted_at: null,
  };
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function setUpRpc(rows: PostRow[]) {
  const calls: RpcCall[] = [];
  mockedClient.mockReturnValue({
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data: rows, error: null });
    },
  } as never);
  return calls;
}

describe("campaign post search query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the trimmed phrase, cursor and page size to the database function", async () => {
    const page = [row("post-3", 30, "the lantern still burns")];
    const calls = setUpRpc(page);

    const result = await searchCampaignPosts({
      campaignId: "campaign-1",
      query: "  lantern  ",
      cursor: { createdAt: "2026-11-27T11:00:00.000Z", id: "post-4" },
      pageSize: 5,
    });

    expect(calls).toEqual([
      {
        name: "search_campaign_posts",
        args: {
          p_campaign_id: "campaign-1",
          p_query: "lantern",
          p_before_created_at: "2026-11-27T11:00:00.000Z",
          p_before_id: "post-4",
          p_limit: 5,
        },
      },
    ]);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      id: "post-3",
      channelId: "channel-1",
      authorId: "player-1",
      text: "the lantern still burns",
    });
    expect(result.nextCursor).toBeUndefined();
  });

  it("uses the default page size and a null cursor for a first page", async () => {
    const calls = setUpRpc([]);

    await searchCampaignPosts({ campaignId: "campaign-1", query: "bog" });

    expect(calls[0].args).toEqual({
      p_campaign_id: "campaign-1",
      p_query: "bog",
      p_before_created_at: null,
      p_before_id: null,
      p_limit: CHAT_SEARCH_PAGE_SIZE,
    });
  });

  it("holds back the lookahead row and cursors from the last returned post", async () => {
    const rows = [
      row("post-3", 30, "needle one"),
      row("post-2", 60, "needle two"),
      row("post-1", 90, "needle three"),
    ];
    setUpRpc(rows);

    const result = await searchCampaignPosts({
      campaignId: "campaign-1",
      query: "needle",
      pageSize: 2,
    });

    expect(result.posts.map((post) => post.id)).toEqual(["post-3", "post-2"]);
    expect(result.nextCursor).toEqual({
      createdAt: rows[1].created_at,
      id: "post-2",
    });
  });

  it("clamps a forged page size to the server's 50-row cap", async () => {
    const calls = setUpRpc([]);

    await searchCampaignPosts({
      campaignId: "campaign-1",
      query: "bog",
      pageSize: 500,
    });

    expect(calls[0].args.p_limit).toBe(50);
  });

  it("maps a rolled row into the same post shape the feed uses", async () => {
    mockedClient.mockReturnValue({
      rpc: () =>
        Promise.resolve({
          data: [
            {
              ...row("post-roll", 0, ""),
              roll: {
                type: ROLL_TYPE.STAT,
                rollLabel: "Edge",
                action: 4,
                challenge1: 3,
                challenge2: 8,
                result: ROLL_RESULT.WEAK_HIT,
                timestamp: "2026-11-27T12:00:00.000Z",
                characterId: "character-1",
                uid: "player-1",
                gmsOnly: false,
              },
              gms_only: true,
            },
          ],
          error: null,
        }),
    } as never);

    const result = await searchCampaignPosts({
      campaignId: "campaign-1",
      query: "edge",
    });

    expect(result.posts[0]).toMatchObject({
      id: "post-roll",
      text: "",
      gmsOnly: true,
    });
    expect(result.posts[0].roll).toMatchObject({
      type: ROLL_TYPE.STAT,
      uid: "player-1",
      characterId: null,
      timestamp: new Date("2026-11-27T12:00:00.000Z"),
    });
  });

  it("refuses a blank phrase before it reaches the database", async () => {
    const calls = setUpRpc([]);

    await expect(
      searchCampaignPosts({ campaignId: "campaign-1", query: "   " })
    ).rejects.toThrow(/words/i);
    await expect(
      searchCampaignPosts({ campaignId: "", query: "bog" })
    ).rejects.toThrow(/campaign/i);
    expect(calls).toEqual([]);
  });

  it("passes a database error through", async () => {
    const failure = { message: "search failed" };
    mockedClient.mockReturnValue({
      rpc: () => Promise.resolve({ data: null, error: failure }),
    } as never);

    await expect(
      searchCampaignPosts({ campaignId: "campaign-1", query: "bog" })
    ).rejects.toEqual(failure);
  });
});
