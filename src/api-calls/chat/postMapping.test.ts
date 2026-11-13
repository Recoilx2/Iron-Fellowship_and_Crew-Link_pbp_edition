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
    speaker_npc_id: null,
    text: "We push on through the bog.",
    image_paths: ["campaign-1/post-1/lantern.png"],
    roll: null,
    gms_only: false,
    created_at: "2026-11-13T12:00:00.000Z",
    updated_at: "2026-11-13T12:00:00.000Z",
    edited_at: null,
    deleted_at: null,
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
      speakerNpcId: null,
      text: "We push on through the bog.",
      imagePaths: ["campaign-1/post-1/lantern.png"],
      roll: null,
      gmsOnly: false,
      createdAt: "2026-11-13T12:00:00.000Z",
      editedAt: null,
      deletedAt: null,
    });
    // Posting as self leaves no speaker character: the interface shows the
    // player's display name (and a GM tag for GMs) instead.
    expect(
      postRowToDocument(row({ speaker_character_id: null }))
    ).toMatchObject({ speakerCharacterId: null, speakerNpcId: null });
    // A GM's NPC voice names the NPC, never a character: one voice per post.
    expect(
      postRowToDocument(
        row({ speaker_character_id: null, speaker_npc_id: "npc-1" })
      )
    ).toMatchObject({ speakerCharacterId: null, speakerNpcId: "npc-1" });
  });

  it("carries the edit and soft-delete markers the feed shows", () => {
    expect(postRowToDocument(row())).toMatchObject({
      editedAt: null,
      deletedAt: null,
    });
    // An edit stamps the row; the feed shows the new text with an edited
    // marker beside it.
    expect(
      postRowToDocument(
        row({
          text: "We push on through the bog, quietly.",
          edited_at: "2026-11-13T12:05:00.000Z",
        })
      )
    ).toMatchObject({
      text: "We push on through the bog, quietly.",
      editedAt: "2026-11-13T12:05:00.000Z",
      deletedAt: null,
    });
    // A soft delete clears the content but keeps the row; the feed shows a
    // "post deleted" marker in its place.
    expect(
      postRowToDocument(
        row({ text: "", deleted_at: "2026-11-13T12:06:00.000Z" })
      )
    ).toMatchObject({
      text: "",
      editedAt: null,
      deletedAt: "2026-11-13T12:06:00.000Z",
    });
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
      image_paths: [],
      roll: { ...roll, timestamp: roll.timestamp.toISOString() },
      gms_only: true,
    });
    // A text-only post stores no roll and stays open to every member.
    expect(
      postDocumentToColumns({ text: "Just words.", roll: null })
    ).toEqual({
      text: "Just words.",
      image_paths: [],
      roll: null,
      gms_only: false,
    });
  });

  it("reads an old single-group custom dice roll unchanged", () => {
    // Rolls stored before the mixed-dice breakdown carry no dieGroups.
    const stored = {
      type: ROLL_TYPE.CUSTOM_DICE,
      notation: "2d6",
      dieSides: 6,
      dieValues: [3, 4],
      modifier: 0,
      total: 7,
      rollLabel: "2d6",
      timestamp: "2026-11-13T12:00:00.000Z",
      characterId: "character-1",
      uid: "player-1",
      gmsOnly: false,
    };
    const document = postRowToDocument(
      row({ text: "", image_paths: [], roll: stored })
    );
    // The stored roll comes back unchanged: same dice, no breakdown added,
    // its timestamp a Date again for the roll card.
    expect(document.roll).toEqual({
      ...stored,
      timestamp: new Date("2026-11-13T12:00:00.000Z"),
    });
    expect(document.roll).not.toHaveProperty("dieGroups");
    // And the round trip stores the same shape it read.
    expect(
      postDocumentToColumns({ text: "", roll: document.roll })
    ).toMatchObject({ roll: stored });
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
