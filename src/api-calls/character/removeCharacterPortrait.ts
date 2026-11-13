import { createApiFunction } from "api-calls/createApiFunction";
import { removePortraitFile } from "api-calls/character/portraitStorage";
import { updateCharacter } from "./updateCharacter";

export const removeCharacterPortrait = createApiFunction<
  {
    uid: string;
    characterId: string;
    oldPortraitFilename: string;
  },
  void
>(async (params) => {
  const { uid, characterId, oldPortraitFilename } = params;

  await updateCharacter({
    characterId,
    character: { profileImage: null },
  });
  await removePortraitFile(uid, characterId, oldPortraitFilename);
}, "Failed to remove old character portrait");
