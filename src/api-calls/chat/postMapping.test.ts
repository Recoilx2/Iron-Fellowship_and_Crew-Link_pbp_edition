import { describe, expect, it } from "vitest";

import {
  CHAT_POSTS_TABLE,
  constructChannelPostsChannelName,
  constructChannelPostsFilter,
  postDocumentToColumns,
  postPayloadToChange,
  postRowToDocument,
  type PostRow,
} from "api-calls/chat/_postRef";
import { ROLL_RESULT, ROLL_TYPE, type Roll } from "types/DieRolls.type";

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
    roll: null,
    gms_only: false,
    created_at: "2026-11-13T12:00:00.000Z",
    updated_at: "2026-11-13T12:00:00.000Z",
    ...overrides,
  };
}

function statRoll(): Roll {
  return {
    type: ROLL_TYPE.STAT,
    rollLabel: "Edge",
    moveName: "Face Danger",
    action: 4,
    challenge1: 3,
    challenge2: 8,
    result: ROLL_RESULT.WEAK_HIT,
    timestamp: new Date("2026-11-13T12:00:00.000Z"),
    characterId: "character-1",
    uid: "player-1",
    gmsOnly: false,
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
      roll: null,
      gmsOnly: false,
      createdAt: "2026-11-13T12:00:00.000Z",
    });
    // Posting as self leaves no speaker character: the interface shows the
    // player's display name (and a GM tag for GMs) instead.
    expect(
      postRowToDocument(row({ speaker_character_id: null }))
    ).toMatchObject({ speakerCharacterId: null });
  });

  it("reads a rolled post with its existing roll shape and GM-only flag", () => {
    const roll = statRoll();
    const document = postRowToDocument(
      row({
        roll: { ...roll, timestamp: roll.timestamp.toISOString() },
        gms_only: true,
      })
    );
    // The stored roll comes back unchanged: same dice, same shape, its
    // timestamp a Date again for the roll card.
    expect(document.roll).toEqual(roll);
    expect(document.gmsOnly).toBe(true);
  });

  it("writes a roll post storing the existing roll shape unchanged", () => {
    const roll = statRoll();
    const columns = postDocumentToColumns({
      text: "Face the storm.",
      roll,
      gmsOnly: true,
    });
    // The roll travels as one JSON document with its timestamp inside,
    // exactly as the campaign roll log stores it.
    expect(columns).toEqual({
      text: "Face the storm.",
      roll: { ...roll, timestamp: roll.timestamp.toISOString() },
      gms_only: true,
    });
    // A text-only post stores no roll and stays open to every member.
    expect(
      postDocumentToColumns({ text: "Just words.", roll: null })
    ).toEqual({ text: "Just words.", roll: null, gms_only: false });
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
