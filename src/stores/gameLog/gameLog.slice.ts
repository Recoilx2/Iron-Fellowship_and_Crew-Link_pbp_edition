import { CreateSliceType } from "stores/store.type";
import { GameLogSlice } from "./gameLog.slice.type";
import { addRoll } from "api-calls/game-log/addRoll";
import { postCampaignRoll } from "api-calls/chat/postCampaignRoll";
import { defaultChatSpeaker } from "functions/chatSpeaker";
import { defaultGameLogSlice } from "./gameLog.slice.default";
import { removeLog } from "api-calls/game-log/removeLog";
import { updateLog } from "api-calls/game-log/updateLog";
import { listenToLogs } from "api-calls/game-log/listenToLogs";

export const createGameLogSlice: CreateSliceType<GameLogSlice> = (
  set,
  getState
) => ({
  ...defaultGameLogSlice,

  addRoll: ({ characterId, campaignId, roll }) => {
    // A roll made in a campaign posts to the campaign's starting IC
    // channel as the channel-kind speaker (ticket #30): the author's
    // campaign character in character, nobody otherwise. Solo rolls keep
    // the character roll log.
    if (campaignId) {
      const state = getState();
      const uid = state.auth.uid;
      const characterMap =
        state.campaigns.currentCampaign.characters.characterMap ?? {};
      const myCharacterId = Object.entries(characterMap).find(
        ([, character]) => character.uid === uid
      )?.[0];
      const { characterId: speakerCharacterId } = defaultChatSpeaker(
        "IC",
        myCharacterId
      );
      return postCampaignRoll({ campaignId, speakerCharacterId, roll });
    }
    if (!characterId) {
      return new Promise((res, reject) =>
        reject("Either character or campaign Id must be defined.")
      );
    }
    return addRoll({ characterId, roll });
  },
  updateRoll: (id, roll) => {
    const campaignId = getState().campaigns.currentCampaign.currentCampaignId;
    const characterId =
      getState().characters.currentCharacter.currentCharacterId;

    if (!characterId && !campaignId) {
      return new Promise((res, reject) =>
        reject("Either character or campaign Id must be defined.")
      );
    }

    return updateLog({ characterId, campaignId, logId: id, log: roll });
  },
  removeRoll: (id) => {
    const campaignId = getState().campaigns.currentCampaign.currentCampaignId;
    const characterId =
      getState().characters.currentCharacter.currentCharacterId;

    if (!characterId && !campaignId) {
      return new Promise((res, reject) =>
        reject("Either character or campaign Id must be defined.")
      );
    }

    return removeLog({ characterId, campaignId, logId: id });

  },

  loadMoreLogs: () => {
    const state = getState();
    if (state.gameLog.loading) {
      return;
    }

    set((store) => {
      store.gameLog.totalLogsToLoad += 20;
    });
  },

  subscribe: (params) => {
    const state = getState();

    const isGM =
      (!params.campaignId ||
        state.campaigns.currentCampaign.currentCampaign?.gmIds?.includes(
          state.auth.uid
        )) ??
      false;
    return listenToLogs({
      ...params,
      isGM,
      updateLog: (logId, log) => {
        set((store) => {
          store.gameLog.logs[logId] = log;
          if (store.appState.rolls[logId]) {
            store.appState.rolls[logId] = log;
          }
        });
      },
      removeLog: (logId) => {
        set((store) => {
          delete store.gameLog.logs[logId];
        });
      },
      onError: (error) => {
        console.error(error);
      },
    });
  },

  resetStore: () => {
    set((store) => {
      store.gameLog = { ...store.gameLog, ...defaultGameLogSlice };
    });
  },
});
