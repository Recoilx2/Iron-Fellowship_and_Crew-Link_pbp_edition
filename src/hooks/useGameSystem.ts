import {
  getGameSystem,
  getIsGameSystemConfigured,
  getIsLocalEnvironment,
} from "functions/getGameSystem";
import { GAME_SYSTEMS } from "types/GameSystems.type";

const isLocal = getIsLocalEnvironment();
const LOCAL_STORAGE_KEY = "game-system";

export function getSystem() {
  const defaultGameSystem = getGameSystem();

  // The site container serves one configured game system; switching only
  // exists in local development, where no system is configured.
  if (getIsGameSystemConfigured()) {
    return defaultGameSystem;
  }

  let localStorageGameSystem: GAME_SYSTEMS | undefined = undefined;
  if (localStorage.getItem(LOCAL_STORAGE_KEY) === GAME_SYSTEMS.IRONSWORN) {
    localStorageGameSystem = GAME_SYSTEMS.IRONSWORN;
  } else if (
    localStorage.getItem(LOCAL_STORAGE_KEY) === GAME_SYSTEMS.STARFORGED
  ) {
    localStorageGameSystem = GAME_SYSTEMS.STARFORGED;
  }

  return !isLocal
    ? defaultGameSystem
    : localStorageGameSystem ?? defaultGameSystem;
}
export function useGameSystem() {
  const gameSystem = getSystem();

  const chooseGameSystem = (gameSystem: GAME_SYSTEMS) => {
    if (!getIsGameSystemConfigured() && isLocal) {
      localStorage.setItem(LOCAL_STORAGE_KEY, gameSystem);
    }
  };

  return { gameSystem, chooseGameSystem };
}
