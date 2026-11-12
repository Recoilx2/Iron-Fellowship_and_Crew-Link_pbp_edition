import { getDocs } from "firebase/firestore";
import { getCharacterAssetCollection } from "./_getRef";
import { AssetDocument } from "./_asset.type";

export interface CharacterAssetExportRecord {
  id: string;
  data: AssetDocument;
}

/**
 * One-shot fetch of a character's assets for export purposes.
 */
export async function getCharacterAssetsForExport(
  characterId: string
): Promise<CharacterAssetExportRecord[]> {
  const snapshot = await getDocs(getCharacterAssetCollection(characterId));
  return snapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    data: docSnapshot.data(),
  }));
}
