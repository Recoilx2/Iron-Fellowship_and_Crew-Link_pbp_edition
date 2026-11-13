import { describe, expect, it } from "vitest";

import type { Datasworn } from "@datasworn-community/core";
import {
  getMoveRollOptions,
  isActionRollMove,
} from "../chatMoveOptions";

// The move picker offers every action-roll move for the character's ruleset,
// not just moves rolled with a stat: condition meters (Resupply's Supply),
// fixed values and asset-backed options count too. These tests pin the
// option extraction with hand-built moves shaped like the ruleset's.
function move(
  overrides: Record<string, unknown> = {}
): Datasworn.Move {
  return {
    _id: "move:test/strike",
    name: "Strike",
    roll_type: "action_roll",
    text: "Strike hard.",
    trigger: { conditions: [] },
    ...overrides,
  } as unknown as Datasworn.Move;
}

function conditionWith(options: unknown[]) {
  return { roll_options: options };
}

describe("isActionRollMove", () => {
  it("keeps action rolls, including ones with no stat", () => {
    expect(
      isActionRollMove(
        move({
          trigger: {
            conditions: [
              conditionWith([{ using: "condition_meter", condition_meter: "supply" }]),
            ],
          },
        })
      )
    ).toBe(true);
  });

  it("drops progress rolls and moves that roll nothing", () => {
    expect(isActionRollMove(move({ roll_type: "progress_roll" }))).toBe(false);
    expect(isActionRollMove(move({ roll_type: "no_roll" }))).toBe(false);
  });
});

describe("getMoveRollOptions", () => {
  it("collects stats across every condition", () => {
    const options = getMoveRollOptions(
      move({
        trigger: {
          conditions: [
            conditionWith([{ using: "stat", stat: "edge" }]),
            conditionWith([
              { using: "stat", stat: "edge" },
              { using: "stat", stat: "iron" },
            ]),
          ],
        },
      })
    );
    expect(options).toEqual([
      { kind: "stat", key: "edge" },
      { kind: "stat", key: "iron" },
    ]);
  });

  it("collects condition meters the way Resupply needs", () => {
    const options = getMoveRollOptions(
      move({
        trigger: {
          conditions: [
            conditionWith([
              { using: "stat", stat: "wits" },
              { using: "condition_meter", condition_meter: "supply" },
            ]),
          ],
        },
      })
    );
    expect(options).toEqual([
      { kind: "stat", key: "wits" },
      { kind: "condition_meter", key: "supply" },
    ]);
  });

  it("collects fixed values and asset-backed options", () => {
    const options = getMoveRollOptions(
      move({
        trigger: {
          conditions: [
            conditionWith([
              { using: "custom", label: "Ration", value: 2 },
              {
                using: "asset_control",
                assets: null,
                control: "integrity",
              },
            ]),
          ],
        },
      })
    );
    expect(options).toEqual([
      { kind: "custom", key: "Ration:2", label: "Ration", value: 2 },
      { kind: "asset", key: "integrity", label: "integrity" },
    ]);
  });

  it("surfaces asset-backed options for display only; chat never rolls them", () => {
    // Ticket #123 keeps the sheet roll on purpose: the speaker's assets are
    // not loaded in chat, and loading them would be new data work. The
    // picker shows these options as chips plus the sheet-roll note (see
    // ChatRollPickers) and excludes them from the rollable entries, so an
    // asset-only move offers no Roll button from chat.
    const options = getMoveRollOptions(
      move({
        trigger: {
          conditions: [
            conditionWith([
              {
                using: "asset_control",
                assets: null,
                control: "integrity",
              },
            ]),
          ],
        },
      })
    );
    expect(options).toEqual([
      { kind: "asset", key: "integrity", label: "integrity" },
    ]);
    expect(
      options.every((option) => option.kind === "asset")
    ).toBe(true);
  });

  it("returns no options when a move rolls nothing", () => {
    expect(getMoveRollOptions(move())).toEqual([]);
    expect(
      getMoveRollOptions(move({ trigger: undefined }))
    ).toEqual([]);
    expect(
      getMoveRollOptions(move({ roll_type: "progress_roll" }))
    ).toEqual([]);
  });
});
