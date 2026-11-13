import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  rollPostPayloadToChange,
  type KnownRollChannels,
} from "api-calls/chat/listenToCampaignRollPosts";
import type { PostRow } from "api-calls/chat/_postRef";
import { updateLog } from "api-calls/game-log/updateLog";
import { removeLog } from "api-calls/game-log/removeLog";
import { deleteAllLogs } from "api-calls/game-log/deleteAllLogs";
import { ROLL_RESULT, ROLL_TYPE } from "types/DieRolls.type";

vi.mock("config/supabase.config");

function postRow(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: "post-1",
    channel_id: "ic-1",
    author_id: "player-1",
    speaker_character_id: "kira",
    speaker_npc_id: null,
    text: "",
    image_paths: [],
    roll: {
      type: ROLL_TYPE.STAT,
      rollLabel: "Edge",
      action: 4,
      challenge1: 3,
      challenge2: 8,
      result: ROLL_RESULT.WEAK_HIT,
      timestamp: "2026-11-13T12:00:00.000Z",
      characterId: "kira",
      uid: "player-1",
      gmsOnly: false,
    },
    gms_only: false,
    created_at: "2026-11-13T12:00:00.000Z",
    updated_at: "2026-11-13T12:00:00.000Z",
    edited_at: null,
    deleted_at: null,
    ...overrides,
  };
}

// Seam under test: the campaign roll log is a view of roll posts, so the
// live filter only lets roll posts through, and the old log's mutations
// fail closed (posted dice are immutable) instead of touching a dropped
// table. Reads are covered by the live access-rule tests.
describe("campaign roll log view filter", () => {
  const known: KnownRollChannels = new Set(["ic-1", "ooc-1"]);

  it("lets a roll post in a campaign channel through", () => {
    const change = rollPostPayloadToChange(known, {
      eventType: "INSERT",
      new: postRow(),
      old: null,
    });
    expect(change).toEqual({ kind: "upsert", row: postRow() });
  });

  it("drops a text-only post", () => {
    const change = rollPostPayloadToChange(known, {
      eventType: "INSERT",
      new: postRow({ id: "post-2", roll: null, text: "Hello" }),
      old: null,
    });
    expect(change).toBeNull();
  });

  it("drops a roll post from outside the campaign", () => {
    const change = rollPostPayloadToChange(known, {
      eventType: "INSERT",
      new: postRow({ id: "post-3", channel_id: "elsewhere" }),
      old: null,
    });
    expect(change).toBeNull();
  });

  it("reads a soft-deleted roll post as gone from the log", () => {
    const change = rollPostPayloadToChange(known, {
      eventType: "UPDATE",
      new: postRow({ deleted_at: "2026-11-13T13:00:00.000Z", text: "" }),
      old: { id: "post-1" },
    });
    expect(change).toEqual({ kind: "remove", key: "post-1" });
  });
});

describe("campaign log mutations fail closed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("refuses to change posted dice", async () => {
    await expect(
      updateLog({
        campaignId: "campaign-1",
        logId: "post-1",
        log: {
          type: ROLL_TYPE.CUSTOM_DICE,
          notation: "1d6",
          dieSides: 6,
          dieValues: [4],
          modifier: 0,
          total: 4,
          rollLabel: "1d6",
          timestamp: new Date(),
          characterId: null,
          uid: "player-1",
          gmsOnly: false,
        },
      })
    ).rejects.toThrow(/immutable/);
  });

  it("refuses to delete a roll post from the log", async () => {
    await expect(
      removeLog({ campaignId: "campaign-1", logId: "post-1" })
    ).rejects.toThrow(/chat/);
  });

  it("refuses to clear the campaign log", async () => {
    await expect(deleteAllLogs({ campaignId: "campaign-1" })).rejects.toThrow(
      /chat/
    );
  });
});
