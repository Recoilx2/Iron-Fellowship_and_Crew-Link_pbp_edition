import { getSystemOracleIds } from "config/mechanics.config";
import { getActiveRulesetId } from "data/activeRuleset";

/**
 * Ask-the-oracle odds for the active ruleset. The shipped ids come from the
 * game-system config; a replacement package can override any threshold.
 */
export function useSystemOracles() {
  return { askTheOracle: getSystemOracleIds(getActiveRulesetId()) };
}

export function useSystemOracle() {
  const { askTheOracle } = useSystemOracles();

  return (oracleKey: keyof typeof askTheOracle) => {
    return askTheOracle[oracleKey];
  };
}
