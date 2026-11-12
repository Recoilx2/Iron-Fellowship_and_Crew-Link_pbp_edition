import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import {
  CHARACTER_ASSETS_TABLE,
  CAMPAIGN_ASSETS_TABLE,
  characterAssetPayloadToChange,
  characterAssetRowToDocument,
  campaignAssetPayloadToChange,
  campaignAssetRowToDocument,
  constructCharacterAssetsChannelName,
  constructCharacterAssetsFilter,
  constructCampaignAssetsChannelName,
  constructCampaignAssetsFilter,
  type CampaignAssetRow,
  type CharacterAssetRow,
} from "./_getRef";
import { AssetDocument } from "api-calls/assets/_asset.type";

export function listenToAssets(
  characterId: string | undefined,
  campaignId: string | undefined,
  onAssets: (assets: { [assetId: string]: AssetDocument }) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe {
  if (!characterId && !campaignId) {
    onError(new Error("Either character or campaign id must be defined."));
    return () => {};
  }
  if (campaignId) {
    const client = getSupabaseClient();
    return listenToRows<CampaignAssetRow>({
      client,
      channelName: constructCampaignAssetsChannelName(campaignId),
      bindings: [
        {
          type: "postgres_changes",
          table: CAMPAIGN_ASSETS_TABLE,
          filter: constructCampaignAssetsFilter(campaignId),
          toChange: campaignAssetPayloadToChange,
        },
      ],
      fetchRows: async () => {
        const { data, error } = await client
          .from(CAMPAIGN_ASSETS_TABLE)
          .select("*")
          .eq("campaign_id", campaignId);
        if (error) {
          throw error;
        }
        return (data ?? []) as unknown as CampaignAssetRow[];
      },
      getKey: (row) => row.id,
      getUpdatedAt: (row) => row.updated_at,
      onRows: (rows) => {
        const assetMap: { [assetId: string]: AssetDocument } = {};
        for (const row of rows) {
          assetMap[row.id] = campaignAssetRowToDocument(row);
        }
        onAssets(assetMap);
      },
      onError,
    });
  }
  if (!characterId) {
    onError(new Error("Either character or campaign id must be defined."));
    return () => {};
  }
  const client = getSupabaseClient();
  return listenToRows<CharacterAssetRow>({
    client,
    channelName: constructCharacterAssetsChannelName(characterId),
    bindings: [
      {
        type: "postgres_changes",
        table: CHARACTER_ASSETS_TABLE,
        filter: constructCharacterAssetsFilter(characterId),
        toChange: characterAssetPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(CHARACTER_ASSETS_TABLE)
        .select("*")
        .eq("character_id", characterId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CharacterAssetRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const assetMap: { [assetId: string]: AssetDocument } = {};
      for (const row of rows) {
        assetMap[row.id] = characterAssetRowToDocument(row);
      }
      onAssets(assetMap);
    },
    onError,
  });
}
