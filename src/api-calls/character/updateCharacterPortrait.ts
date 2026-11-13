import {
  removePortraitFile,
  uploadPortraitFile,
} from "api-calls/character/portraitStorage";
import { updateCharacter } from "./updateCharacter";
import { getCharacterForExport } from "./getCharacterForExport";
import { createApiFunction } from "api-calls/createApiFunction";

export const updateCharacterPortrait = createApiFunction<
  {
    uid: string;
    characterId: string;
    oldPortraitFilename?: string;
    portrait?: File;
    scale: number;
    position: { x: number; y: number };
  },
  void
>(async (params) => {
  const { uid, characterId, oldPortraitFilename, portrait, scale, position } =
    params;

  if (portrait) {
    const filename = await uploadPortraitFile(uid, characterId, portrait);
    await updateCharacter({
      characterId,
      character: { profileImage: { filename, position, scale } },
    });
    if (oldPortraitFilename && oldPortraitFilename !== filename) {
      await removePortraitFile(uid, characterId, oldPortraitFilename).catch(
        (e) => console.error(e)
      );
    }
    return;
  }

  const existing = await getCharacterForExport(characterId);
  const filename = existing?.data.profileImage?.filename;
  if (!filename) {
    throw new Error("No portrait to reposition");
  }
  await updateCharacter({
    characterId,
    character: { profileImage: { filename, position, scale } },
  });
}, "Failed to update character portrait");
