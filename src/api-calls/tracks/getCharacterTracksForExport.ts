import { getDocs } from "firebase/firestore";
import { getCharacterTracksCollection } from "./_getRef";

export interface CharacterTrackExportRecord {
  id: string;
  data: Record<string, unknown>;
  createdDate?: Date;
}

/**
 * One-shot fetch of a character's progress tracks for export purposes.
 * Track timestamps are converted to plain dates at the edge; legacy
 * documents without a timestamp simply omit `createdDate`.
 */
export async function getCharacterTracksForExport(
  characterId: string
): Promise<CharacterTrackExportRecord[]> {
  const snapshot = await getDocs(getCharacterTracksCollection(characterId));
  return snapshot.docs.map((docSnapshot) => {
    const { createdTimestamp, ...rest } = docSnapshot.data();
    const createdDate = createdTimestamp?.toDate() ?? undefined;
    return {
      id: docSnapshot.id,
      data: { ...rest },
      ...(createdDate ? { createdDate } : {}),
    };
  });
}
