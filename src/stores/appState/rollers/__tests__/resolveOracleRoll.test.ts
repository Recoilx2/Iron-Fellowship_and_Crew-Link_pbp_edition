import { describe, expect, it } from "vitest";

import type { Datasworn } from "@datasworn-community/core";
import { ROLL_TYPE } from "types/DieRolls.type";
import {
  lookupRollableOracle,
  resolveOracleRoll,
  type OracleDieRoller,
} from "../resolveOracleRoll";

// The app's oracle resolution, worked out once here and reused by the
// character-sheet roller and the chat composer: one column at a time, shared
// rolls across every column, extra text cells kept raw for the caller to
// strip. Dice come from an injected roller, so these tests pin the rules with
// known-good literals, never real dice.

function rollerFor(values: Record<string, number | undefined>) {
  const roller: OracleDieRoller = {
    rollExpression: async (expression) => values[expression],
  };
  return roller;
}

function smallTable(
  overrides: Record<string, unknown> = {}
): Datasworn.OracleRollable {
  return {
    _id: "oracle_rollable:test/small",
    type: "oracle_rollable",
    name: "Small Table",
    oracle_type: "table_text",
    dice: "1d100",
    rows: [
      {
        _id: "oracle_rollable.row:test/small.1",
        roll: { min: 1, max: 50 },
        text: "Low",
      },
      {
        _id: "oracle_rollable.row:test/small.2",
        roll: { min: 51, max: 100 },
        text: "High",
      },
    ],
    ...overrides,
  } as unknown as Datasworn.OracleRollable;
}

const meta = { characterId: "character-1", uid: "player-1", gmsOnly: false };

describe("resolveOracleRoll", () => {
  it("rolls a single table in the app's oracle roll shape", () => {
    return resolveOracleRoll(
      smallTable(),
      rollerFor({ "1d100": 73 }),
      meta
    ).then((roll) => {
      expect(roll).toMatchObject({
        type: ROLL_TYPE.ORACLE_TABLE,
        rollLabel: "Small Table",
        oracleId: "oracle_rollable:test/small",
        roll: 73,
        result: "High",
        characterId: "character-1",
        uid: "player-1",
        gmsOnly: false,
      });
    });
  });

  it("rolls nothing when the dice give nothing", () => {
    return resolveOracleRoll(
      smallTable(),
      rollerFor({ "1d100": undefined }),
      meta
    ).then((roll) => {
      expect(roll).toBeUndefined();
    });
  });

  it("rolls nothing for a collection of tables", () => {
    const collection = smallTable({ oracle_type: "tables" });
    return resolveOracleRoll(collection, rollerFor({}), meta).then((roll) => {
      expect(roll).toBeUndefined();
    });
  });

  it("rolls nothing for a shared-results table", () => {
    const shared = smallTable({ oracle_type: "table_shared_text" });
    return resolveOracleRoll(shared, rollerFor({}), meta).then((roll) => {
      expect(roll).toBeUndefined();
    });
  });

  it("rolls every column of a shared-rolls table, sorted by name", () => {
    const shared = smallTable({
      oracle_type: "table_shared_rolls",
      contents: {
        zeta: {
          name: "Zeta",
          dice: "1d10",
          rows: [
            {
              _id: "oracle_rollable.row:test/zeta.1",
              roll: { min: 1, max: 10 },
              text: "Zed",
            },
          ],
        },
        alpha: {
          name: "Alpha",
          dice: "1d6",
          rows: [
            {
              _id: "oracle_rollable.row:test/alpha.1",
              roll: { min: 1, max: 6 },
              text: "Aye",
            },
          ],
        },
      },
    });
    return resolveOracleRoll(
      shared,
      rollerFor({ "1d10": 4, "1d6": 2 }),
      meta
    ).then((roll) => {
      expect(roll?.roll).toEqual([2, 4]);
      expect(roll?.result).toBe("* Alpha: Aye\n* Zeta: Zed");
    });
  });

  it("keeps extra text cells on the roll", () => {
    const actionTheme = smallTable({
      oracle_type: "table_text2",
      column_labels: { text: "Action", text2: "Theme" },
      rows: [
        {
          _id: "oracle_rollable.row:test/action-theme.1",
          roll: { min: 1, max: 100 },
          text: "Strike",
          text2: "Ruin",
        },
      ],
    });
    return resolveOracleRoll(
      actionTheme,
      rollerFor({ "1d100": 12 }),
      meta
    ).then((roll) => {
      expect(roll?.result).toBe("Strike");
      expect(roll?.text2).toBe("Theme: Ruin");
    });
  });
});

describe("lookupRollableOracle", () => {
  it("rolls nothing for an unknown table", () => {
    expect(lookupRollableOracle("oracle_rollable:no/such_table")).toBeUndefined();
  });
});
