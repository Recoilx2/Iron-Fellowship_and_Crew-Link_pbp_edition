import {
  defaultAssetMaps,
  defaultConditionMeters,
  defaultImpacts,
  defaultMoveMaps,
  defaultNonLinearMeters,
  defaultOracleMaps,
  defaultProgressTracks,
  defaultRootMoveCollectionIds,
  defaultRootOracleCollectionIds,
  defaultRuleset,
  defaultSpecialTracks,
  defaultStats,
  defaultWorldTruths,
} from "./baseRules";
import { getActiveRulesetId } from "data/activeRuleset";
import { RulesSliceData } from "./rules.slice.type";

export const defaultRulesSlice: RulesSliceData = {
  expansionIds: [],
  activeRulesetId: getActiveRulesetId(),
  baseRuleset: defaultRuleset,
  progressTracks: defaultProgressTracks,
  stats: defaultStats,
  conditionMeters: defaultConditionMeters,
  specialTracks: defaultSpecialTracks,
  impacts: defaultImpacts,
  rootOracleCollectionIds: defaultRootOracleCollectionIds,
  oracleMaps: defaultOracleMaps,
  rootMoveCollectionIds: defaultRootMoveCollectionIds,
  moveMaps: defaultMoveMaps,
  assetMaps: defaultAssetMaps,
  nonLinearMeters: defaultNonLinearMeters,
  worldTruths: defaultWorldTruths ?? {},
};
