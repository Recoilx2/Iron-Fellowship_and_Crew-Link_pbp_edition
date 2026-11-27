import { afterEach, describe, expect, it } from "vitest";
import {
  applyMechanics,
  DEFAULT_MECHANICS,
  getMechanics,
  getMomentumTrack,
  getProgressTracks,
  getSystemOracleIds,
  resetMechanics,
} from "../mechanics.config";
import { AskTheOracle } from "../system.config";
import {
  burnMomentumResult,
  isMomentumBurnUseful,
} from "functions/momentumBurn";
import { scoreStatRoll } from "stores/appState/rollers/scoreStatRoll";
import { ROLL_RESULT, ROLL_TYPE, type StatRoll } from "types/DieRolls.type";

afterEach(() => resetMechanics());

const miss: StatRoll = {
  type: ROLL_TYPE.STAT,
  action: 3,
  challenge1: 6,
  challenge2: 8,
  modifier: 0,
  result: ROLL_RESULT.MISS,
  rollLabel: "test",
  timestamp: new Date(),
  characterId: null,
  uid: "uid",
  gmsOnly: false,
};

describe("mechanics defaults and overrides", () => {
  it("keeps Ironsworn dice math as the default", () => {
    expect(getMechanics()).toEqual(DEFAULT_MECHANICS);
    expect(scoreStatRoll({ action: 10, modifier: 2, challenge1: 9, challenge2: 9 }).total)
      .toBe(10);
    expect(isMomentumBurnUseful(miss, 6)).toBe(false);
    expect(isMomentumBurnUseful(miss, 7)).toBe(true);
    expect(getMomentumTrack()).toEqual({ min: -6, max: 10, startingValue: 2 });
    expect(getProgressTracks("classic")).toEqual(["Combat", "Vow", "Journey"]);
    expect(getProgressTracks("starforged")).toContain("Scene Challenge");
  });

  it("lets a package change the action total cap and negative momentum", () => {
    applyMechanics({
      actionTotalCap: 12,
      momentumBurn: { negativeMomentumCancels: false },
    });

    expect(
      scoreStatRoll({ action: 12, modifier: 1, challenge1: 9, challenge2: 9 })
        .total,
    ).toBe(12);
    expect(
      scoreStatRoll({
        action: 4,
        momentum: -4,
        challenge1: 1,
        challenge2: 1,
      }).matchedNegativeMomentum,
    ).toBe(false);
    // Unspecified settings keep their Ironsworn defaults.
    expect(getMechanics().momentumBurn.min).toBe(-6);
  });

  it("lets a package change momentum burn", () => {
    applyMechanics({
      momentumBurn: { liftOnTie: true, min: -4, max: 8, startingValue: 1 },
    });

    expect(isMomentumBurnUseful(miss, 6)).toBe(true);
    expect(burnMomentumResult(miss, 8)).toBe(ROLL_RESULT.HIT);
    expect(getMomentumTrack()).toEqual({ min: -4, max: 8, startingValue: 1 });

    applyMechanics({ momentumBurn: { enabled: false } });
    expect(isMomentumBurnUseful(miss, 10)).toBe(false);
  });

  it("lets a package change progress tracks and oracle thresholds", () => {
    applyMechanics({
      progressTracks: ["Oath", "Trail", "Peril"],
      oracleThresholds: {
        [AskTheOracle.Likely]: "move:frontier/fate/ask_the_oracle.likely",
      },
    });

    expect(getProgressTracks("frontier")).toEqual(["Oath", "Trail", "Peril"]);
    expect(getSystemOracleIds("frontier").likely).toBe(
      "move:frontier/fate/ask_the_oracle.likely",
    );
    expect(getSystemOracleIds("frontier").almost_certain).toContain("classic");
    resetMechanics();
    expect(getSystemOracleIds("starforged").likely).toContain("starforged");
  });
});
