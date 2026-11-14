import { ROLL_RESULT, ROLL_TYPE, type Roll, type StatRoll } from "types/DieRolls.type";

/**
 * The momentum-burn rule shared by the character sheet and chat (ticket
 * #125). A burn replaces the action total with the character's momentum:
 * a miss lifts when momentum beats either challenge die, a weak hit lifts
 * only when it beats both, and a hit never needs burning. An already-burned
 * roll burns never again. The sheet's NormalRollActions and chat's composer
 * and posted-roll burn use this one rule, so the same dice burn the same
 * way everywhere.
 */
export function isMomentumBurnUseful(
  roll: Roll,
  momentum: number
): boolean {
  if (roll.type !== ROLL_TYPE.STAT || roll.momentumBurned !== undefined) {
    return false;
  }
  if (
    roll.result === ROLL_RESULT.MISS &&
    (momentum > roll.challenge1 || momentum > roll.challenge2)
  ) {
    return true;
  }
  if (
    roll.result === ROLL_RESULT.WEAK_HIT &&
    momentum > roll.challenge1 &&
    momentum > roll.challenge2
  ) {
    return true;
  }
  return false;
}

/**
 * The outcome a burn earns: momentum beats both challenge dice for a hit,
 * either one for a weak hit, else the miss stands. Callers check
 * `isMomentumBurnUseful` first; this keeps the sheet's existing burn math
 * in one place for chat to reuse.
 */
export function burnMomentumResult(
  roll: StatRoll,
  momentum: number
): ROLL_RESULT {
  if (momentum > roll.challenge1 && momentum > roll.challenge2) {
    return ROLL_RESULT.HIT;
  }
  if (momentum > roll.challenge1 || momentum > roll.challenge2) {
    return ROLL_RESULT.WEAK_HIT;
  }
  return ROLL_RESULT.MISS;
}
