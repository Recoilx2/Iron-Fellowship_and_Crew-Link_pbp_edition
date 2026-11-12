import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
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

  // Campaign rolls stream from the campaign roll log table, newest first
  // with a client-side window. GM-only rolls never reach non-GMs: the
  // database refuses the rows, and the listener skips them as well.
  if (campaignId) {
    const client = getSupabaseClient();
    let previousIds = new Set<string>();
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
        let rowsQuery = client
          .from(CAMPAIGN_ROLLS_TABLE)
          .select("*")
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: false })
          .limit(totalLogsToLoad);
        if (!isGM) {
          rowsQuery = rowsQuery.eq("gms_only", false);
        }
        const { data, error } = await rowsQuery;
        if (error) {
          throw error;
        }
        return (data ?? []) as unknown as CampaignRollRow[];
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
          updateLog(row.id, campaignRollRowToRoll(row));
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
