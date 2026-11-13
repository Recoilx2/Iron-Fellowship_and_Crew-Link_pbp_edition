import { describe, expect, it } from "vitest";

import {
  CHAT_POSTS_TABLE,
  constructChannelPostsChannelName,
  constructChannelPostsFilter,
  postPayloadToChange,
  postRowToDocument,
  type PostRow,
} from "api-calls/chat/_postRef";

// Seam under test: the chat data layer is the only place that names the
// posts table, its live-update channel and its row shape. Stores and
// components only ever see post documents.
function row(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: "post-1",
    channel_id: "channel-1",
    author_id: "player-1",
    speaker_character_id: "character-1",
    text: "We push on through the bog.",
    created_at: "2026-11-13T12:00:00.000Z",
    updated_at: "2026-11-13T12:00:00.000Z",
    ...overrides,
  };
}

describe("chat post mapping", () => {
  it("names the posts table stores subscribe to", () => {
    expect(CHAT_POSTS_TABLE).toBe("chat_posts");
    expect(constructChannelPostsChannelName("channel-1")).toBe(
      "channel-posts:channel-1"
    );
    expect(constructChannelPostsFilter("channel-1")).toBe(
      "channel_id=eq.channel-1"
    );
  });

  it("reads a row as the post document the feed shows", () => {
    expect(postRowToDocument(row())).toEqual({
      channelId: "channel-1",
      authorId: "player-1",
      speakerCharacterId: "character-1",
      text: "We push on through the bog.",
      createdAt: "2026-11-13T12:00:00.000Z",
    });
    // Posting as self leaves no speaker character: the interface shows the
    // player's display name (and a GM tag for GMs) instead.
    expect(
      postRowToDocument(row({ speaker_character_id: null }))
    ).toMatchObject({ speakerCharacterId: null });
  });

  it("turns row events into upserts and deletes into removals", () => {
    const post = row();
    expect(
      postPayloadToChange({ eventType: "INSERT", new: post, old: null })
    ).toEqual({ kind: "upsert", row: post });
    expect(
      postPayloadToChange({ eventType: "UPDATE", new: post, old: null })
    ).toEqual({ kind: "upsert", row: post });
    expect(
      postPayloadToChange({
        eventType: "DELETE",
        new: {},
        old: { id: "post-1" },
      })
    ).toEqual({ kind: "remove", key: "post-1" });
    expect(postPayloadToChange({ eventType: "DELETE", new: {}, old: {} })).toBeNull();
    expect(
      postPayloadToChange({ eventType: "INSERT", new: {}, old: null })
    ).toBeNull();
  });
});
