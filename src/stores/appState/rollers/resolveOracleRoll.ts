import { Datasworn, IdParser } from "@datasworn-community/core";

import { idMap } from "data/idMap";
import { OracleTableRoll, ROLL_TYPE } from "types/DieRolls.type";

/**
 * The app's oracle resolution, worked out once here and reused by the
 * character-sheet roller (`useRoller` via `rollOracle`) and the chat composer
 * (`chatRolls`): one column at a time, shared rolls across every column
 * sorted by name, extra text cells kept raw. Dice come from an injected
 * roller, so the sheet rolls with its animated dice while chat and tests pin
 * theirs; link stripping stays with each caller, as before.
 */
export interface OracleDieRoller {
  rollExpression(expression: string): Promise<number | undefined>;
}

export interface OracleRollMeta {
  characterId: string | null;
  uid: string;
  gmsOnly: boolean;
}

/** A legacy id resolves the way the game log roller always has. */
export function lookupRollableOracle(
  oracleId: string
): Datasworn.OracleRollable | undefined {
  const resolved = idMap[oracleId] ?? oracleId;
  try {
    const oracle = IdParser.get(resolved) as Datasworn.OracleRollable;
    if (!oracle || oracle.type !== "oracle_rollable") {
      return undefined;
    }
    return oracle;
  } catch {
    return undefined;
  }
}

async function resolveOracleColumn(
  column: Datasworn.OracleRollable,
  roller: OracleDieRoller
): Promise<{ roll: number; result: Datasworn.OracleRollableRow } | undefined> {
  const roll = await roller.rollExpression(column.dice);
  if (roll === undefined) {
    return undefined;
  }
  const result = column.rows.find(
    (row) => row.roll && row.roll.min <= roll && row.roll.max >= roll
  );
  if (!result) {
    return undefined;
  }
  return { roll, result };
}

export async function resolveOracleRoll(
  oracle: Datasworn.OracleCollection | Datasworn.OracleRollable | undefined,
  roller: OracleDieRoller,
  meta: OracleRollMeta
): Promise<OracleTableRoll | undefined> {
  // We cannot roll across multiple tables like this
  if (!oracle || oracle.oracle_type === "tables") {
    return undefined;
  } else if (
    oracle.oracle_type === "table_shared_text" ||
    oracle.oracle_type === "table_shared_text2" ||
    oracle.oracle_type === "table_shared_text3"
  ) {
    return undefined;
  }

  let resultString: string | undefined;
  let rolls: number | number[] | undefined;
  let result2: string | undefined;
  let result3: string | undefined;

  if (oracle.oracle_type === "table_shared_rolls") {
    const tmpRolls: number[] = [];
    const lines: string[] = [];
    const columns = Object.values(oracle.contents ?? {}).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const column of columns) {
      const rolled = await resolveOracleColumn(column, roller);
      if (rolled) {
        tmpRolls.push(rolled.roll);
        lines.push(`* ${column.name}: ${rolled.result.text}`);
      }
    }
    resultString = lines.join("\n");
    rolls = tmpRolls;
  } else {
    const rolled = await resolveOracleColumn(
      oracle as Datasworn.OracleRollable,
      roller
    );
    if (rolled) {
      rolls = rolled.roll;
      resultString = rolled.result.text;
      if (
        oracle.oracle_type === "table_text2" ||
        oracle.oracle_type === "table_text3"
      ) {
        const columnLabel2 = (
          oracle as Datasworn.OracleTableText2
        ).column_labels.text2;
        const text2 = (
          rolled.result as Datasworn.OracleRollableRowText2
        ).text2;
        const columnLabel3 = (
          oracle as Datasworn.OracleTableText3
        ).column_labels.text3;
        const text3 = (rolled.result as Datasworn.OracleRollableRowText3)
          .text3;
        if (text2) {
          result2 = columnLabel2 ? `${columnLabel2}: ${text2}` : text2;
        }
        if (text3) {
          result3 = columnLabel3 ? `${columnLabel3}: ${text3}` : text3;
        }
      }
    }
  }

  if (resultString === undefined || rolls === undefined) {
    return undefined;
  }
  const roll: OracleTableRoll = {
    type: ROLL_TYPE.ORACLE_TABLE,
    rollLabel: oracle.name,
    timestamp: new Date(),
    characterId: meta.characterId,
    uid: meta.uid,
    gmsOnly: meta.gmsOnly,
    roll: rolls,
    result: resultString,
    oracleId: oracle._id,
  };
  if (result2) {
    roll.text2 = result2;
  }
  if (result3) {
    roll.text3 = result3;
  }
  return roll;
}
