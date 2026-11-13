import { describe, expect, it } from "vitest";

import { ROLL_RESULT } from "types/DieRolls.type";
import { scoreStatRoll } from "../scoreStatRoll";

// The app's action-roll scoring, worked out once here and reused by the
// character-sheet roller and the chat composer: an action die and two
// challenge dice, totals capped at ten, with the negative-momentum rule.
// Expected values are known-good literals, never real dice.
describe("scoreStatRoll", () => {
  it("scores a weak hit when the total beats one challenge die", () => {
    // Action 4 plus stat 3 totals 7, against 3 and 8.
    expect(
      scoreStatRoll({
        action: 4,
        modifier: 3,
        challenge1: 3,
        challenge2: 8,
      })
    ).toEqual({
      total: 7,
      result: ROLL_RESULT.WEAK_HIT,
      matchedNegativeMomentum: false,
    });
  });

  it("caps the total at ten", () => {
    expect(
      scoreStatRoll({
        action: 6,
        modifier: 5,
        adds: 4,
        challenge1: 1,
        challenge2: 2,
      }).total
    ).toBe(10);
  });

  it("misses when the total beats neither challenge die", () => {
    expect(
      scoreStatRoll({
        action: 2,
        modifier: 1,
        challenge1: 9,
        challenge2: 10,
      }).result
    ).toBe(ROLL_RESULT.MISS);
  });

  it("hits when the total beats both challenge dice", () => {
    expect(
      scoreStatRoll({
        action: 6,
        modifier: 5,
        challenge1: 1,
        challenge2: 2,
      }).result
    ).toBe(ROLL_RESULT.HIT);
  });

  it("cancels the action die on matched negative momentum", () => {
    // Action 3 matches momentum -3, so the action die counts as 0: a miss
    // against 4 and 5.
    expect(
      scoreStatRoll({
        action: 3,
        modifier: 0,
        challenge1: 4,
        challenge2: 5,
        momentum: -3,
      })
    ).toEqual({
      total: 0,
      result: ROLL_RESULT.MISS,
      matchedNegativeMomentum: true,
    });
  });

  it("leaves the action die alone without matching negative momentum", () => {
    expect(
      scoreStatRoll({
        action: 3,
        modifier: 0,
        challenge1: 4,
        challenge2: 5,
        momentum: -2,
      }).matchedNegativeMomentum
    ).toBe(false);
  });
});
