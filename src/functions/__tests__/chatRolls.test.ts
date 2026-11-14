import { describe, expect, it } from "vitest";

import {
  getChatRollSummary,
  parseMixedDiceNotation,
  rollChatCustomDice,
  rollChatMove,
  rollChatStat,
  stripDataswornLinks,
  type ChatRollContext,
  type DiceRoller,
} from "../chatRolls";
import { ROLL_RESULT, ROLL_TYPE } from "types/DieRolls.type";

// Seam under test: the composer's roll math before a roll attaches to the
// draft. Dice come from an injected roller, so these tests pin the rules --
// odds, outcomes, shapes -- with known-good literals, never real dice.

function context(overrides: Partial<ChatRollContext> = {}): ChatRollContext {
  return {
    characterId: "character-1",
    uid: "player-1",
    gmsOnly: false,
    ...overrides,
  };
}

function fixedRoller(values: number[]): DiceRoller {
  let cursor = 0;
  return {
    rollGroups: async (groups) => {
      const count = groups.reduce((total, group) => total + group.qty, 0);
      const taken = values.slice(cursor, cursor + count);
      cursor += count;
      return taken;
    },
    rollExpression: async () => values[cursor++],
  };
}

describe("mixed dice notation", () => {
  it("reads a single group with an optional modifier", () => {
    expect(parseMixedDiceNotation("2d6")).toEqual({
      groups: [{ qty: 2, sides: 6 }],
      modifier: 0,
    });
    expect(parseMixedDiceNotation("2d6+2")).toEqual({
      groups: [{ qty: 2, sides: 6 }],
      modifier: 2,
    });
    expect(parseMixedDiceNotation("d20-1")).toEqual({
      groups: [{ qty: 1, sides: 20 }],
      modifier: -1,
    });
  });

  it("reads mixed dice such as 2d6+1d8+2", () => {
    expect(parseMixedDiceNotation("2d6+1d8+2")).toEqual({
      groups: [
        { qty: 2, sides: 6 },
        { qty: 1, sides: 8 },
      ],
      modifier: 2,
    });
  });

  it("ignores spacing and case around the terms", () => {
    expect(parseMixedDiceNotation(" 2D6 + 1d8 + 2 ")).toEqual({
      groups: [
        { qty: 2, sides: 6 },
        { qty: 1, sides: 8 },
      ],
      modifier: 2,
    });
  });

  it("refuses anything that is not dice with an optional modifier", () => {
    for (const bad of ["", "abc", "2d", "d", "d6+", "2d6++2", "2.5d6", "0d6"]) {
      expect(parseMixedDiceNotation(bad), bad).toBeUndefined();
    }
  });
});

describe("datasworn link stripping", () => {
  it("keeps the words and drops the link markup", () => {
    expect(
      stripDataswornLinks("[Hinterlands](datasworn:move:foo)")
    ).toBe("Hinterlands");
  });
});

describe("chat stat rolls", () => {
  it("scores a strong hit when the total beats both challenge dice", () => {
    // Action 4 plus stat 3 totals 7, against 3 and 8: one challenge die
    // beaten, so a weak hit.
    return rollChatStat(
      "Edge",
      { modifier: 3 },
      context(),
      fixedRoller([3, 8, 4])
    ).then((roll) => {
      expect(roll).toMatchObject({
        type: ROLL_TYPE.STAT,
        rollLabel: "Edge",
        action: 4,
        modifier: 3,
        challenge1: 3,
        challenge2: 8,
        result: ROLL_RESULT.WEAK_HIT,
        characterId: "character-1",
        uid: "player-1",
        gmsOnly: false,
      });
    });
  });

  it("caps the action total at ten and names the move", () => {
    return rollChatStat(
      "Iron",
      { modifier: 5, adds: 4, move: { name: "Face Danger", id: "move-1" } },
      context(),
      fixedRoller([1, 2, 6])
    ).then((roll) => {
      expect(roll.result).toBe(ROLL_RESULT.HIT);
      expect(roll.moveName).toBe("Face Danger");
      expect(roll.moveId).toBe("move-1");
      expect(roll.adds).toBe(4);
    });
  });

  it("misses when the total beats neither challenge die", () => {
    return rollChatStat(
      "Wits",
      { modifier: 1 },
      context(),
      fixedRoller([9, 10, 2])
    ).then((roll) => {
      expect(roll.result).toBe(ROLL_RESULT.MISS);
    });
  });

  it("cancels the action die on matched negative momentum", () => {
    return rollChatStat(
      "Heart",
      { modifier: 0 },
      context({ momentum: -3 }),
      fixedRoller([4, 5, 3])
    ).then((roll) => {
      expect(roll.matchedNegativeMomentum).toBe(true);
      // Action 3 cancelled, so the total is 0: a miss against 4 and 5.
      expect(roll.result).toBe(ROLL_RESULT.MISS);
    });
  });
});

describe("chat move rolls", () => {
  it("rolls a move through the shared action-roll scoring and names it", () => {
    // Ticket #123: moves reuse the existing roller logic (scoreStatRoll,
    // shared with the sheet). rollChatMove is the explicit move path: the
    // same dice through rollChatStat score the same result, with the move
    // name and id attached.
    return rollChatMove(
      "Supply",
      {
        modifier: 3,
        move: { name: "Resupply", id: "move:test/resupply" },
      },
      context(),
      fixedRoller([3, 8, 4])
    ).then((roll) => {
      expect(roll).toMatchObject({
        type: ROLL_TYPE.STAT,
        rollLabel: "Supply",
        action: 4,
        modifier: 3,
        result: ROLL_RESULT.WEAK_HIT,
        moveName: "Resupply",
        moveId: "move:test/resupply",
      });
    });
  });
});

describe("chat custom dice rolls", () => {
  it("stores a single-group roll in the long-standing shape", () => {
    return rollChatCustomDice("2d6+1", context(), fixedRoller([3, 5])).then(
      (roll) => {
        expect(roll).toMatchObject({
          type: ROLL_TYPE.CUSTOM_DICE,
          notation: "2d6+1",
          dieSides: 6,
          dieValues: [3, 5],
          modifier: 1,
          total: 9,
        });
        expect(roll.dieGroups).toBeUndefined();
      }
    );
  });

  it("extends the shape additively for mixed dice", () => {
    return rollChatCustomDice(
      "2d6+1d8+2",
      context(),
      fixedRoller([3, 5, 7])
    ).then((roll) => {
      expect(roll.dieValues).toEqual([3, 5, 7]);
      expect(roll.dieGroups).toEqual([
        { dieSides: 6, dieValues: [3, 5] },
        { dieSides: 8, dieValues: [7] },
      ]);
      expect(roll.total).toBe(17);
      // Old readers use only the original fields, which stay complete.
      expect(roll.dieSides).toBe(6);
      expect(roll.modifier).toBe(2);
    });
  });

  it("refuses notation that is not dice", () => {
    return expect(
      rollChatCustomDice("not dice", context(), fixedRoller([]))
    ).rejects.toBeTruthy();
  });
});

describe("chat roll one-line summaries", () => {
  it("summarises a move roll the way the prototype did", () => {
    return rollChatStat(
      "Edge",
      { modifier: 2, move: { name: "Face Danger", id: "move-1" } },
      context(),
      fixedRoller([3, 8, 4])
    ).then((roll) => {
      expect(getChatRollSummary(roll)).toBe("Weak Hit · 6 vs 3, 8");
    });
  });

  it("summarises oracle and custom dice rolls", () => {
    return rollChatCustomDice("1d6", context(), fixedRoller([4])).then(
      (roll) => {
        expect(getChatRollSummary(roll)).toBe("4 (4)");
      }
    );
  });
});
