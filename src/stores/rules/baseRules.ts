import { Datasworn } from "@datasworn-community/core";
import { getActiveRulesetId } from "data/activeRuleset";
import { getProgressTracks } from "config/mechanics.config";
import { ruleset } from "data/rulesets";
import { parseOraclesIntoMaps } from "./helpers/parseOraclesIntoMaps";
import { parseMovesIntoMaps } from "./helpers/parseMovesIntoMaps";
import { parseAssetsIntoMaps } from "./helpers/parseAssetsIntoMaps";

/** Every store default derived from the active base ruleset. */
export interface BaseRulesDefaults {
  ruleset?: Datasworn.Ruleset;
  progressTracks: string[];
  stats: Datasworn.Rules["stats"];
  conditionMeters: Datasworn.Rules["condition_meters"];
  specialTracks: Datasworn.Rules["special_tracks"];
  impacts: Datasworn.Rules["impacts"];
  rootOracleCollectionIds: string[];
  oracleMaps: ReturnType<typeof parseOraclesIntoMaps>;
  rootMoveCollectionIds: string[];
  moveMaps: ReturnType<typeof parseMovesIntoMaps>;
  assetMaps: ReturnType<typeof parseAssetsIntoMaps>;
  nonLinearMeters: Record<string, never>;
  worldTruths: Datasworn.Ruleset["truths"];
}

export function deriveBaseRules(
  loadedRuleset?: Datasworn.Ruleset,
  rulesetId = getActiveRulesetId(),
): BaseRulesDefaults {
  return {
    ruleset: loadedRuleset,
    progressTracks: getProgressTracks(rulesetId),
    stats: loadedRuleset?.rules.stats ?? {},
    conditionMeters: loadedRuleset?.rules.condition_meters ?? {},
    specialTracks: loadedRuleset?.rules.special_tracks ?? {},
    impacts: loadedRuleset?.rules.impacts ?? {},
    rootOracleCollectionIds: Object.values(loadedRuleset?.oracles ?? {}).map(
      (oracle) => oracle._id,
    ),
    oracleMaps: parseOraclesIntoMaps(loadedRuleset?.oracles ?? {}),
    rootMoveCollectionIds: Object.values(loadedRuleset?.moves ?? {}).map(
      (move) => move._id,
    ),
    moveMaps: parseMovesIntoMaps(loadedRuleset?.moves ?? {}),
    assetMaps: parseAssetsIntoMaps(loadedRuleset?.assets ?? {}),
    nonLinearMeters: {},
    worldTruths: loadedRuleset?.truths ?? {},
  };
}

let currentDefaults = deriveBaseRules(ruleset);

/**
 * Runs during async bootstrap, after a mounted replacing ruleset has been
 * registered, so defaults are derived from the ruleset actually in use
 * before any consumer reads them.
 */
export function applyBaseRules(
  loadedRuleset?: Datasworn.Ruleset,
  rulesetId = getActiveRulesetId(),
): BaseRulesDefaults {
  currentDefaults = deriveBaseRules(loadedRuleset, rulesetId);
  // Live bindings for the legacy named imports in rules.slice.default.ts.
  defaultRuleset = currentDefaults.ruleset;
  defaultProgressTracks = currentDefaults.progressTracks;
  defaultStats = currentDefaults.stats;
  defaultConditionMeters = currentDefaults.conditionMeters;
  defaultSpecialTracks = currentDefaults.specialTracks;
  defaultImpacts = currentDefaults.impacts;
  defaultRootOracleCollectionIds = currentDefaults.rootOracleCollectionIds;
  defaultOracleMaps = currentDefaults.oracleMaps;
  defaultRootMoveCollectionIds = currentDefaults.rootMoveCollectionIds;
  defaultMoveMaps = currentDefaults.moveMaps;
  defaultAssetMaps = currentDefaults.assetMaps;
  defaultNonLinearMeters = currentDefaults.nonLinearMeters;
  defaultWorldTruths = currentDefaults.worldTruths;
  return currentDefaults;
}

export function getBaseRulesDefaults(): BaseRulesDefaults {
  return currentDefaults;
}

export let defaultRuleset = currentDefaults.ruleset;
export let defaultProgressTracks = currentDefaults.progressTracks;
export let defaultStats = currentDefaults.stats;
export let defaultConditionMeters = currentDefaults.conditionMeters;
export let defaultSpecialTracks = currentDefaults.specialTracks;
export let defaultImpacts = currentDefaults.impacts;
export let defaultRootOracleCollectionIds =
  currentDefaults.rootOracleCollectionIds;
export let defaultOracleMaps = currentDefaults.oracleMaps;
export let defaultRootMoveCollectionIds = currentDefaults.rootMoveCollectionIds;
export let defaultMoveMaps = currentDefaults.moveMaps;
export let defaultAssetMaps = currentDefaults.assetMaps;
export let defaultNonLinearMeters = currentDefaults.nonLinearMeters;
export let defaultWorldTruths = currentDefaults.worldTruths;
