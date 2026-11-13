import { SettingsSliceData } from "./settings.slice.type";

export const defaultSettings: SettingsSliceData = {
  customStats: [],
  customTracks: [],

  hiddenCustomMoveIds: [],
  hiddenCustomOracleIds: [],

  pinnedOraclesIds: {},
};
