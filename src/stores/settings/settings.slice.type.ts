import { Unsubscribe } from "api-calls/helpers.type";
import { CustomTrack } from "types/CustomTrackSettings.type";
import { SettingsDocument } from "api-calls/character-campaign-settings/_character-campaign-settings.type";

export interface SettingsSliceData {
  customStats: string[];
  customTracks: CustomTrack[];

  hiddenCustomMoveIds: string[];
  hiddenCustomOracleIds: string[];

  pinnedOraclesIds: { [oracleId: string]: boolean };
}

export interface SettingsSliceActions {
  subscribe: (userIds: string[]) => Unsubscribe;
  subscribeToSettings: (params: {
    characterId?: string;
    campaignId?: string;
  }) => Unsubscribe;

  subscribeToPinnedOracleSettings: (uid: string) => Unsubscribe;

  toggleCustomMoveVisibility: (
    moveId: string,
    hidden: boolean
  ) => Promise<void>;
  toggleCustomOracleVisibility: (
    oracleId: string,
    hidden: boolean
  ) => Promise<void>;

  togglePinnedOracle: (oracleId: string, pinned: boolean) => Promise<void>;

  updateSettings: (
    settings: Partial<SettingsDocument>,
    useUpdate?: boolean
  ) => Promise<void>;

  resetStore: () => void;
}

export type SettingsSlice = SettingsSliceData & SettingsSliceActions;
