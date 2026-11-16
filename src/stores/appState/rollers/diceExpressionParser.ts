import { logError } from "functions/errorReference";
/**
 * FROM DATASWORN ---
 * A simple dice roll expression with an optional modifer.
 * @pattern ```javascript
 * /([1-9][0-9]*)d([1-9][0-9]*)([+-]([1-9][0-9]*))?/
 * ```
 * @example "1d100"
 * @example "1d6+2"
 */
export function parseDiceExpression(diceExpression: string):
  | {
      diceCount: number;
      typeOfDice: number;
      modifier: number;
    }
  | undefined {
  if (
    !diceExpression.match(/([1-9][0-9]*)d([1-9][0-9]*)([+-]([1-9][0-9]*))?/)
  ) {
    return undefined;
  }

  const stringSplitOnD = diceExpression.split("d");
  const diceCount = parseInt(stringSplitOnD[0]);

  const stringSplitOnModifierExpression = stringSplitOnD[1].split(/[+-]/);

  const typeOfDice = parseInt(stringSplitOnModifierExpression[0]);
  let modifier = 0;
  if (stringSplitOnModifierExpression.length > 1) {
    modifier =
      parseInt(stringSplitOnModifierExpression[1]) *
      (diceExpression.includes("+") ? 1 : -1);
  }

  if (isNaN(diceCount)) {
    logError("DICE COUNT WAS NaN. ORIGINAL EXPERSSION:", diceExpression);
  }
  if (isNaN(typeOfDice)) {
    logError("TYPE OF DICE WAS NaN. ORIGINAL EXPERSSION:", diceExpression);
  }
  if (isNaN(modifier)) {
    logError("MODIFIER WAS NaN. ORIGINAL EXPERSSION:", diceExpression);
  }

  return { diceCount, typeOfDice, modifier };
}
