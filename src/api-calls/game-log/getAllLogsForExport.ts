import { getDocs, orderBy, query, where } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignGameLogCollection,
  CHARACTER_ROLLS_TABLE,
  characterRollRowToExportRecord,
  type CharacterRollRow,
} from "./_getRef";

export interface GameLogExportRecord {
  id: string;
  roll: Record<string, unknown>;
}

function serializeCampaignLogForExport(log: {
  timestamp?: { toDate?: () => Date };
  [key: string]: unknown;
}): Record<string, unknown> {
  const { timestamp, ...rest } = log;
  const timestampDate = timestamp?.toDate?.();

  return {
    ...rest,
    timestamp: timestampDate?.toISOString() ?? null,
  };
}

export async function getAllLogsForExport(params: {
  campaignId?: string;
  characterId?: string;
  isGM: boolean;
}): Promise<GameLogExportRecord[]> {
  const { campaignId, characterId, isGM } = params;

  if (!campaignId && !characterId) {
    throw new Error("Either campaignId or characterId must be defined.");
  }

  // Campaign rolls belong to the chat spec and stay on Firebase until then.
  if (!characterId || campaignId) {
    const collectionRef = getCampaignGameLogCollection(
      (campaignId ?? characterId) as string
    );

    const q = isGM
      ? query(collectionRef, orderBy("timestamp", "asc"))
      : query(
          collectionRef,
          where("gmsOnly", "==", false),
          orderBy("timestamp", "asc")
        );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      roll: serializeCampaignLogForExport(
        doc.data() as unknown as Parameters<
          typeof serializeCampaignLogForExport
        >[0]
      ),
    }));
  }

  let rowsQuery = getSupabaseClient()
    .from(CHARACTER_ROLLS_TABLE)
    .select("*")
    .eq("character_id", characterId)
    .order("created_at", { ascending: true });
  if (!isGM) {
    rowsQuery = rowsQuery.eq("gms_only", false);
  }
  const { data, error } = await rowsQuery;
  if (error) {
    throw error;
  }
  return ((data ?? []) as unknown as CharacterRollRow[]).map(
    characterRollRowToExportRecord
  );
}
