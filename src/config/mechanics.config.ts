import { AskTheOracle, sharedOracleConfig } from "config/system.config";
import { GAME_SYSTEMS, getValueForSystem } from "types/GameSystems.type";

/** Momentum-burn settings. The defaults are Ironsworn's rules. */
export interface MomentumBurnMechanics {
  enabled: boolean;
  min: number;
  max: number;
  startingValue: number;
  /** Burn lifts on a tie with a challenge die instead of needing to beat it. */
  liftOnTie: boolean;
  negativeMomentumCancels: boolean;
}

export interface MechanicsConfig {
  actionTotalCap: number;
  momentumBurn: MomentumBurnMechanics;
  progressTracks: string[];
  /** Ask-the-oracle odds to Datasworn oracle table ids. */
  oracleThresholds: Partial<Record<AskTheOracle, string>>;
}

const shippedProgressTracks = {
  [GAME_SYSTEMS.IRONSWORN]: ["Combat", "Vow", "Journey"],
  [GAME_SYSTEMS.STARFORGED]: [
    "Combat",
    "Vow",
    "Expedition",
    "Connection",
    "Scene Challenge",
  ],
};

export const DEFAULT_MECHANICS: MechanicsConfig = {
  actionTotalCap: 10,
  momentumBurn: {
    enabled: true,
    min: -6,
    max: 10,
    startingValue: 2,
    liftOnTie: false,
    negativeMomentumCancels: true,
  },
  progressTracks: [],
  oracleThresholds: {},
};

export type MechanicsOverride = Partial<Omit<MechanicsConfig, "momentumBurn">> & {
  momentumBurn?: Partial<MomentumBurnMechanics>;
};

let currentMechanics: MechanicsConfig = DEFAULT_MECHANICS;

/**
 * Applies the mechanics override carried by the active base ruleset package.
 * Partial overrides keep Ironsworn's defaults for everything not specified.
 */
export function applyMechanics(override?: MechanicsOverride): void {
  currentMechanics = override
    ? {
        ...DEFAULT_MECHANICS,
        ...override,
        momentumBurn: {
          ...DEFAULT_MECHANICS.momentumBurn,
          ...override.momentumBurn,
        },
        oracleThresholds: {
          ...override.oracleThresholds,
        },
      }
    : DEFAULT_MECHANICS;
}

export function getMechanics(): MechanicsConfig {
  return currentMechanics;
}

export function resetMechanics(): void {
  currentMechanics = DEFAULT_MECHANICS;
}

export function getProgressTracks(rulesetId: string): string[] {
  if (currentMechanics.progressTracks.length > 0) {
    return [...currentMechanics.progressTracks];
  }
  return [...getValueForSystem(shippedProgressTracks, rulesetId)];
}

export function getMomentumTrack() {
  const { min, max, startingValue } = currentMechanics.momentumBurn;
  return { min, max, startingValue };
}

export function getSystemOracleIds(rulesetId: string) {
  const shipped = getValueForSystem(sharedOracleConfig, rulesetId).askTheOracle;
  return { ...shipped, ...currentMechanics.oracleThresholds };
}
