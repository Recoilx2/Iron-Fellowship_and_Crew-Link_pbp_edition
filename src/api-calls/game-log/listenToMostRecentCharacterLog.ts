import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { listenToCampaignRollPosts } from "api-calls/chat/listenToCampaignRollPosts";
import { Roll } from "types/DieRolls.type";
import {
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

  // A campaign's rolls live as chat roll posts (ticket #30), so the
  // overlay follows the character's recent roll posts instead of a roll
  // log table. GM-only rolls never reach non-GMs: the database refuses the
  // rows, and the listener skips them as well.
  if (campaignId) {
    const subscribedAt = new Date().toISOString();
    const seenIds = new Set<string>();
    return listenToCampaignRollPosts({
      campaignId,
      totalLogsToLoad: 10,
      isGM,
      updateLog: (postId, roll) => {
        if (seenIds.has(postId)) {
          return;
        }
        const rolledAt =
          roll.timestamp instanceof Date
            ? roll.timestamp.toISOString()
            : "";
        if (roll.characterId === characterId && rolledAt > subscribedAt) {
          seenIds.add(postId);
          onRoll(postId, roll);
        }
      },
      removeLog: () => {},
      onError,
    });
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
