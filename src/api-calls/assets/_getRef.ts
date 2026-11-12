import { firestore } from "config/firebase.config";
import {
  collection,
  CollectionReference,
  doc,
  DocumentReference,
} from "firebase/firestore";
import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import { DocumentUpdate } from "api-calls/helpers.type";
import { applyDocumentUpdate } from "api-calls/applyDocumentUpdate";
import { AssetDocument } from "api-calls/assets/_asset.type";

export function constructCharacterAssetCollectionPath(characterId: string) {
  return `/characters/${characterId}/assets`;
}

export function constructCharacterAssetDocPath(
  characterId: string,
  assetId: string
) {
  return `${constructCharacterAssetCollectionPath(characterId)}/${assetId}`;
}

export function constructCampaignAssetCollectionPath(campaignId: string) {
  return `/campaigns/${campaignId}/assets`;
}

export function constructCampaignAssetDocPath(
  campaignId: string,
  assetId: string
) {
  return `${constructCampaignAssetCollectionPath(campaignId)}/${assetId}`;
}

export function getCharacterAssetCollection(characterId: string) {
  return collection(
    firestore,
    constructCharacterAssetCollectionPath(characterId)
  ) as CollectionReference<AssetDocument>;
}

export function getCharacterAssetDoc(characterId: string, assetId: string) {
  return doc(
    firestore,
    constructCharacterAssetDocPath(characterId, assetId)
  ) as DocumentReference<AssetDocument>;
}

export function getCampaignAssetCollection(campaignId: string) {
  return collection(
    firestore,
    constructCampaignAssetCollectionPath(campaignId)
  ) as CollectionReference<AssetDocument>;
}

export function getCampaignAssetDoc(campaignId: string, assetId: string) {
  return doc(
    firestore,
    constructCampaignAssetDocPath(campaignId, assetId)
  ) as DocumentReference<AssetDocument>;
}

// ---------------------------------------------------------------------------
// Supabase (character scope). Campaign assets stay on Firebase until the
// campaigns ticket ports them.
// ---------------------------------------------------------------------------

export const CHARACTER_ASSETS_TABLE = "character_assets";

export interface CharacterAssetRow {
  id: string;
  character_id: string;
  datasworn_id: string;
  enabled_abilities: Record<string, boolean>;
  option_values: Record<string, string>;
  control_values: Record<string, boolean | string | number>;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function constructCharacterAssetsChannelName(
  characterId: string
): string {
  return `character-assets:${characterId}`;
}

export function constructCharacterAssetsFilter(characterId: string): string {
  return `character_id=eq.${characterId}`;
}

export function characterAssetRowToDocument(
  row: CharacterAssetRow
): AssetDocument {
  const document: AssetDocument = {
    id: row.datasworn_id,
    enabledAbilities: row.enabled_abilities ?? {},
    order: row.sort_order,
  };
  if (row.option_values && Object.keys(row.option_values).length > 0) {
    document.optionValues = row.option_values;
  }
  if (row.control_values && Object.keys(row.control_values).length > 0) {
    document.controlValues = row.control_values;
  }
  return document;
}

export function characterAssetDocumentToColumns(
  characterId: string,
  asset: AssetDocument
): Record<string, unknown> {
  return {
    character_id: characterId,
    datasworn_id: asset.id,
    enabled_abilities: asset.enabledAbilities ?? {},
    option_values: asset.optionValues ?? {},
    control_values: asset.controlValues ?? {},
    sort_order: asset.order,
  };
}

const characterAssetFieldToColumn: Record<string, string> = {
  id: "datasworn_id",
  enabledAbilities: "enabled_abilities",
  optionValues: "option_values",
  controlValues: "control_values",
  order: "sort_order",
};

export function characterAssetUpdateToColumns(
  row: CharacterAssetRow,
  asset: DocumentUpdate<AssetDocument>
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: row.datasworn_id,
    enabledAbilities: row.enabled_abilities,
    optionValues: row.option_values,
    controlValues: row.control_values,
    order: row.sort_order,
  };
  const merged = applyDocumentUpdate(
    base,
    asset as Record<string, unknown>
  );
  const touched = new Set(
    Object.keys(asset as Record<string, unknown>).map((path) =>
      path.split(".")[0]
    )
  );
  const columns: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(characterAssetFieldToColumn)) {
    if (touched.has(field)) {
      columns[column] = merged[field] ?? {};
    }
  }
  return columns;
}

export function characterAssetPayloadToChange(
  payload: PostgresChangePayload<CharacterAssetRow>
): RowChange<CharacterAssetRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CharacterAssetRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<CharacterAssetRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as CharacterAssetRow }
    : null;
}
