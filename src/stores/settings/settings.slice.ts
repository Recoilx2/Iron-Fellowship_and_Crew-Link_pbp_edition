import { CreateSliceType } from "stores/store.type";
import { SettingsSlice } from "./settings.slice.type";
import { defaultSettings } from "./settings.slice.default";
import { listenToSettings } from "api-calls/character-campaign-settings/listenToSettings";
import { listenToOracleSettings } from "api-calls/user/settings/listenToOracleSettings";
import { showOrHideCustomMove } from "api-calls/character-campaign-settings/showOrHideCustomMove";
import { showOrHideCustomOracle } from "api-calls/character-campaign-settings/showOrHideCustomOracle";
import { updatePinnedOracle } from "api-calls/user/settings/updatePinnedOracle";
import { updateSettings } from "api-calls/character-campaign-settings/updateSettings";

// Per-user custom moves and oracles lived in Firebase and were not carried
// over (spec #11): homebrew collections are their replacement. This slice
// keeps only the visibility toggles for built-in moves/oracles (backed by
// character/campaign settings rows) and the per-user oracle pins.

export const createSettingsSlice: CreateSliceType<SettingsSlice> = (
  set,
  getState
) => ({
  ...defaultSettings,

  subscribe: (uids) => {
    getState().users.loadUserDocuments(uids);
    return () => {
      getState().settings.resetStore();
    };
  },

  subscribeToSettings: ({ characterId, campaignId }) => {
    if (characterId || campaignId) {
      return listenToSettings(
        campaignId,
        characterId,
        (settings) => {
          set((store) => {
            store.settings.hiddenCustomMoveIds = settings.hiddenCustomMoveIds;
            store.settings.hiddenCustomOracleIds =
              settings.hiddenCustomOraclesIds;

            store.settings.customStats = settings.customStats;
            store.settings.customTracks = Object.values(
              settings.customTracks
            ).sort((ct1, ct2) => ct1.order - ct2.order);
          });
        },
        (error) => {
          console.error(error);
        }
      );
    }
    return () => {};
  },

  subscribeToPinnedOracleSettings: (uid) => {
    return listenToOracleSettings(
      uid,
      (settings) => {
        set((store) => {
          store.settings.pinnedOraclesIds = settings.pinnedOracleSections ?? {};
        });
      },
      (error) => {
        console.error(error);
      }
    );
  },

  toggleCustomMoveVisibility: (moveId, hidden) => {
    const state = getState();

    const campaignId = state.campaigns.currentCampaign.currentCampaignId;
    const characterId = state.characters.currentCharacter.currentCharacterId;

    return showOrHideCustomMove({ campaignId, characterId, moveId, hidden });
  },
  toggleCustomOracleVisibility: (oracleId, hidden) => {
    const state = getState();

    const campaignId = state.campaigns.currentCampaign.currentCampaignId;
    const characterId = state.characters.currentCharacter.currentCharacterId;

    return showOrHideCustomOracle({
      campaignId,
      characterId,
      oracleId,
      hidden,
    });
  },

  togglePinnedOracle: (oracleId, pinned) => {
    const uid = getState().auth.uid;

    return updatePinnedOracle({ uid, oracleId, pinned });
  },

  updateSettings: (settings, useUpdate) => {
    const state = getState();

    const campaignId = state.campaigns.currentCampaign.currentCampaignId;
    const characterId = state.characters.currentCharacter.currentCharacterId;

    return updateSettings({
      campaignId,
      characterId,
      settings,
      useUpdate,
    });
  },

  resetStore: () => {
    set((state) => {
      const pinnedOraclesIds = state.settings.pinnedOraclesIds;
      state.settings = {
        ...state.settings,
        ...defaultSettings,
        pinnedOraclesIds,
      };
    });
  },
});
