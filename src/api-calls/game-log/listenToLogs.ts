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
import { Roll } from "types/DieRolls.type";

export function listenToLogs(params: {
  isGM: boolean;
  campaignId?: string;
  characterId?: string;
  totalLogsToLoad: number;
  updateLog: (rollId: string, roll: Roll) => void;
  removeLog: (rollId: string) => void;
  onError: (error: string) => void;
}): PlainUnsubscribe {
  const {
    isGM,
    campaignId,
    characterId,
    totalLogsToLoad,
    updateLog,
    removeLog,
    onError,
  } = params;

  if (!campaignId && !characterId) {
    onError("Either campaign or character ID must be defined.");
    return () => {};
  }

  // Campaign rolls belong to the chat spec and stay on Firebase until then.
  if (campaignId) {
    const collection = getCampaignGameLogCollection(campaignId as string);

    const queryConstraints: QueryConstraint[] = [
      limit(totalLogsToLoad),
      orderBy("timestamp", "desc"),
    ];
    if (!isGM) {
      queryConstraints.push(where("gmsOnly", "==", false));
    }

    const firebaseUnsubscribe: Unsubscribe = onSnapshot(
      query(collection, ...queryConstraints),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added" || change.type === "modified") {
            const doc = convertFromDatabase(change.doc.data());
            updateLog(change.doc.id, doc);
          } else if (change.type === "removed") {
            removeLog(change.doc.id);
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

  if (!characterId) {
    onError("Either campaign or character ID must be defined.");
    return () => {};
  }
  const client = getSupabaseClient();
  let previousIds = new Set<string>();
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
      let rowsQuery = client
        .from(CHARACTER_ROLLS_TABLE)
        .select("*")
        .eq("character_id", characterId)
        .order("created_at", { ascending: false })
        .limit(totalLogsToLoad);
      if (!isGM) {
        rowsQuery = rowsQuery.eq("gms_only", false);
      }
      const { data, error } = await rowsQuery;
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CharacterRollRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const seen = new Set<string>();
      for (const row of rows) {
        if (!isGM && row.gms_only) {
          continue;
        }
        seen.add(row.id);
        updateLog(row.id, characterRollRowToRoll(row));
      }
      for (const id of previousIds) {
        if (!seen.has(id)) {
          removeLog(id);
        }
      }
      previousIds = seen;
    },
    onError: (error) => {
      console.error(error);
      onError("Error getting new logs.");
    },
  });
}
