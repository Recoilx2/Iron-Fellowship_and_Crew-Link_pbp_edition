import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { CharacterDocument } from "./_character.type";
import { getCharacterDoc } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

interface Params {
  characterId: string;
  character: DocumentUpdate<CharacterDocument>;
}

export const updateCharacter = createApiFunction<Params, void>((params) => {
  const { characterId, character } = params;

  return new Promise((resolve, reject) => {
    updateDoc(getCharacterDoc(characterId), character as UpdateData<CharacterDocument>)
      .then(() => {
        resolve();
      })
      .catch((e) => {
        reject(e);
      });
  });
}, "Failed to update character.");
