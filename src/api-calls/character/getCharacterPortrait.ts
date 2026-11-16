import { getPortraitUrl } from "api-calls/character/portraitStorage";
import { createApiFunction } from "api-calls/createApiFunction";
import { logError } from "functions/errorReference";

export const getCharacterPortraitUrl = createApiFunction<
  {
    uid: string;
    characterId: string;
    filename: string;
  },
  string
>(async (params) => {
  const { uid, characterId, filename } = params;
  try {
    return await getPortraitUrl(uid, characterId, filename);
  } catch (e) {
    logError("getCharacterPortrait", e);
    throw e;
  }
}, "Failed to load character portrait.");
