import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { Roll } from "types/DieRolls.type";
import {
  CHARACTER_ROLLS_TABLE,
  CAMPAIGN_ROLLS_TABLE,
  characterRollPayloadToChange,
  characterRollRowToRoll,
  campaignRollPayloadToChange,
  campaignRollRowToRoll,
  constructCharacterRollsChannelName,
  constructCharacterRollsFilter,
  constructCampaignRollsChannelName,
  constructCampaignRollsFilter,
  type CampaignRollRow,
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

  // The campaign log carries every member's rolls in one table, so the
  // character filter runs inside the roll document. GM-only rolls never
  // reach non-GMs: the database refuses the rows, and the listener skips
  // them as well.
  if (campaignId) {
    const client = getSupabaseClient();
    const subscribedAt = new Date().toISOString();
    const seenIds = new Set<string>();
    return listenToRows<CampaignRollRow>({
      client,
      channelName: constructCampaignRollsChannelName(campaignId),
      bindings: [
        {
          type: "postgres_changes",
          table: CAMPAIGN_ROLLS_TABLE,
          filter: constructCampaignRollsFilter(campaignId),
          toChange: campaignRollPayloadToChange,
        },
      ],
      fetchRows: async () => {
        const { data, error } = await client
          .from(CAMPAIGN_ROLLS_TABLE)
          .select("*")
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: false })
          .limit(10);
        if (error) {
          throw error;
        }
        return (data ?? []) as unknown as CampaignRollRow[];
      },
      getKey: (row) => row.id,
      getUpdatedAt: (row) => row.updated_at,
      onRows: (rows) => {
        for (const row of rows) {
          if (!isGM && row.gms_only) {
            continue;
          }
          const roll = campaignRollRowToRoll(row);
          if (
            roll.characterId === characterId &&
            row.created_at > subscribedAt &&
            !seenIds.has(row.id)
          ) {
            seenIds.add(row.id);
            onRoll(row.id, roll);
          }
        }
      },
      onError: (error) => {
        console.error(error);
        onError("Error getting new logs.");
      },
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
