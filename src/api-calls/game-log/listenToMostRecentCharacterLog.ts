import {
  QueryConstraint,
  Unsubscribe,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { Roll } from "types/DieRolls.type";
import {
  convertFromDatabase,
  getCampaignGameLogCollection,
  CHARACTER_ROLLS_TABLE,
  characterRollPayloadToChange,
  characterRollRowToRoll,
  constructCharacterRollsChannelName,
  constructCharacterRollsFilter,
  type CharacterRollRow,
} from "./_getRef";

export function listenToMostRecentCharacterLog(params: {
  isGM: boolean;
  campaignId?: string;
  characterId: string;
  onRoll: (rollId: string, roll: Roll) => void;
  onError: (error: string) => void;
}): PlainUnsubscribe {
  const { isGM, campaignId, characterId, onRoll, onError } = params;

  // Campaign rolls belong to the chat spec and stay on Firebase until then.
  if (campaignId) {
    const collection = getCampaignGameLogCollection(campaignId);

    const queryConstraints: QueryConstraint[] = [
      where("timestamp", ">", new Date()),
      where("characterId", "==", characterId),
      orderBy("timestamp", "desc"),
      limit(1),
    ];
    if (!isGM) {
      queryConstraints.push(where("gmsOnly", "==", false));
    }

    const firebaseUnsubscribe: Unsubscribe = onSnapshot(
      query(collection, ...queryConstraints),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const doc = convertFromDatabase(change.doc.data());
            onRoll(change.doc.id, doc);
          }
        });
      },
      (error) => {
        console.error(error);
        onError("Error getting new logs.");
      }
    );
    return firebaseUnsubscribe;
  }

  const client = getSupabaseClient();
  const subscribedAt = new Date().toISOString();
  const seenIds = new Set<string>();
  return listenToRows<CharacterRollRow>({
    client,
    channelName: constructCharacterRollsChannelName(characterId),
    bindings: [
      {
        type: "postgres_changes",
        table: CHARACTER_ROLLS_TABLE,
        filter: constructCharacterRollsFilter(characterId),
        toChange: characterRollPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(CHARACTER_ROLLS_TABLE)
        .select("*")
        .eq("character_id", characterId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CharacterRollRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      for (const row of rows) {
        if (!isGM && row.gms_only) {
          continue;
        }
        if (row.created_at > subscribedAt && !seenIds.has(row.id)) {
          seenIds.add(row.id);
          onRoll(row.id, characterRollRowToRoll(row));
        }
      }
    },
    onError: (error) => {
      console.error(error);
      onError("Error getting new logs.");
    },
  });
}
