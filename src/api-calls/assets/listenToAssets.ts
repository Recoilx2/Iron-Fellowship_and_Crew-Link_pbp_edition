import { onSnapshot } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import {
  getCampaignAssetCollection,
  getCharacterAssetCollection,
  CHARACTER_ASSETS_TABLE,
  characterAssetPayloadToChange,
  characterAssetRowToDocument,
  constructCharacterAssetsChannelName,
  constructCharacterAssetsFilter,
  type CharacterAssetRow,
} from "./_getRef";
import { AssetDocument } from "api-calls/assets/_asset.type";

function listenToFirebaseAssets(
  characterId: string | undefined,
  campaignId: string | undefined,
  onAssets: (assets: { [assetId: string]: AssetDocument }) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe {
  return onSnapshot(
    characterId
      ? getCharacterAssetCollection(characterId)
      : getCampaignAssetCollection(campaignId as string),
    (snapshot) => {
      const assetMap: { [assetId: string]: AssetDocument } = {};

      snapshot.docs.forEach((doc) => (assetMap[doc.id] = doc.data()));
      onAssets(assetMap);
    },
    (error) => onError(error)
  );
}

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
  // Campaign assets stay on Firebase until the campaigns ticket ports them.
  if (!characterId) {
    return listenToFirebaseAssets(characterId, campaignId, onAssets, onError);
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
