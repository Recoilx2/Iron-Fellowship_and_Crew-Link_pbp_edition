import { Datasworn } from "@datasworn-community/core";
import { OracleTableRoll } from "types/DieRolls.type";
import { rollDie } from "./rollDie";
import { Theme } from "@mui/material";
import { resolveOracleRoll } from "./resolveOracleRoll";

/**
 * Rolls an oracle with the sheet's animated dice. The resolution lives in
 * `resolveOracleRoll`, shared with the chat composer; this only plugs in
 * the sheet's dice.
 */
export async function rollOracle(
  oracle: Datasworn.OracleCollection | Datasworn.OracleRollable,
  characterId: string | null,
  uid: string,
  gmsOnly: boolean,
  theme: Theme,
  hide3dDice: boolean
): Promise<OracleTableRoll | undefined> {
  return resolveOracleRoll(
    oracle,
    {
      rollExpression: (expression) => rollDie(expression, theme, hide3dDice),
    },
    { characterId, uid, gmsOnly }
  );
}
