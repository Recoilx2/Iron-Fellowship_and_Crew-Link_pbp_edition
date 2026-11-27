import { getActiveRulesetId } from "data/activeRuleset";
import { GameSystemChooser, getValueForSystem } from "types/GameSystems.type";

/**
 * Reads a per-game value for the active base ruleset. Unknown ids fall back
 * to the Ironsworn entry, so a replacement ruleset inherits Ironsworn's
 * labels and mechanics ids until its package overrides them.
 */
export function useGameSystemValue<T>(values: GameSystemChooser<T>): T {
  return getValueForSystem(values, getActiveRulesetId());
}
