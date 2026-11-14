import { describe, expect, it } from "vitest";

import { ROLL_RESULT, ROLL_TYPE, type StatRoll } from "types/DieRolls.type";
import {
  burnMomentumResult,
  isMomentumBurnUseful,
} from "functions/momentumBurn";

function statRoll(overrides: Partial<StatRoll> = {}): StatRoll {
  return {
    type: ROLL_TYPE.STAT,
    rollLabel: "Edge",
    action: 2,
    challenge1: 3,
    challenge2: 8,
    result: ROLL_RESULT.MISS,
    timestamp: new Date("2026-11-13T12:00:00.000Z"),
    characterId: "kira",
    uid: "player-1",
    gmsOnly: false,
    ...overrides,
  };
}

// Seam under test: the momentum-burn rule shared by the character sheet and
// chat (ticket #125). The sheet's NormalRollActions and chat's composer and
// posted-roll burn use this one rule, so a miss that momentum would lift
// burns the same way everywhere. Dice values are known-good literals, never
// recomputed the way the code does.
describe("momentum burn usefulness", () => {
  it("lifts a miss when momentum beats either challenge die", () => {
    const roll = statRoll({ result: ROLL_RESULT.MISS });
    expect(isMomentumBurnUseful(roll, 5)).toBe(true);
    expect(isMomentumBurnUseful(roll, 3)).toBe(false);
    expect(isMomentumBurnUseful(roll, 9)).toBe(true);
  });

  it("lifts a weak hit only when momentum beats both challenge dice", () => {
    const roll = statRoll({
      result: ROLL_RESULT.WEAK_HIT,
      challenge1: 3,
      challenge2: 8,
    });
    expect(isMomentumBurnUseful(roll, 5)).toBe(false);
    expect(isMomentumBurnUseful(roll, 9)).toBe(true);
  });

  it("never lifts a hit or an already-burned roll", () => {
    expect(
      isMomentumBurnUseful(statRoll({ result: ROLL_RESULT.HIT }), 10)
    ).toBe(false);
    expect(
      isMomentumBurnUseful(
        statRoll({ result: ROLL_RESULT.MISS, momentumBurned: 5 }),
        10
      )
    ).toBe(false);
  });

  it("burns to the outcome momentum earns", () => {
    const miss = statRoll({ result: ROLL_RESULT.MISS });
    expect(burnMomentumResult(miss, 9)).toBe(ROLL_RESULT.HIT);
    expect(burnMomentumResult(miss, 5)).toBe(ROLL_RESULT.WEAK_HIT);
    const weak = statRoll({ result: ROLL_RESULT.WEAK_HIT });
    expect(burnMomentumResult(weak, 9)).toBe(ROLL_RESULT.HIT);
  });
});
