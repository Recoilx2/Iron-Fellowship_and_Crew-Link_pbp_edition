import { ROLL_RESULT } from "types/DieRolls.type";

/**
 * The app's action-roll scoring, worked out once here and reused by the
 * character-sheet roller (`useRoller`) and the chat composer (`chatRolls`):
 * an action die plus a modifier and adds, capped at ten, against two
 * challenge dice, with the negative-momentum rule cancelling the action die
 * when it matches a negative momentum. Dice come from the caller, so this
 * stays pure and both rollers pin the same outcomes.
 */
export interface StatScoreInput {
  action: number;
  modifier?: number;
  adds?: number;
  challenge1: number;
  challenge2: number;
  momentum?: number;
}

export interface StatScore {
  total: number;
  result: ROLL_RESULT;
  matchedNegativeMomentum: boolean;
}

const MAX_ACTION_TOTAL = 10;

export function scoreStatRoll(input: StatScoreInput): StatScore {
  const { action, challenge1, challenge2 } = input;

  let matchedNegativeMomentum = false;
  if (
    input.momentum !== undefined &&
    input.momentum < 0 &&
    Math.abs(input.momentum) === action
  ) {
    matchedNegativeMomentum = true;
  }

  const total = Math.min(
    MAX_ACTION_TOTAL,
    (matchedNegativeMomentum ? 0 : action) +
      (input.modifier ?? 0) +
      (input.adds ?? 0)
  );

  let result: ROLL_RESULT = ROLL_RESULT.WEAK_HIT;
  if (total > challenge1 && total > challenge2) {
    result = ROLL_RESULT.HIT;
  } else if (total <= challenge1 && total <= challenge2) {
    result = ROLL_RESULT.MISS;
  }

  return { total, result, matchedNegativeMomentum };
}
