import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import { SettingsDocument } from "api-calls/character-campaign-settings/_character-campaign-settings.type";

export const CHARACTER_SETTINGS_TABLE = "character_settings";

export interface CharacterSettingsRow {
  character_id: string;
  custom_stats: string[];
  custom_tracks: Record<string, unknown>;
  hidden_custom_oracle_ids: string[];
  hidden_custom_move_ids: string[];
  hide_delve_moves: boolean;
  hide_delve_oracles: boolean;
  updated_at: string;
}

export function constructCharacterSettingsChannelName(
  characterId: string
): string {
  return `character-settings:${characterId}`;
}

export function constructCharacterSettingsFilter(
  characterId: string
): string {
  return `character_id=eq.${characterId}`;
}

const emptySettings: SettingsDocument = {
  hiddenCustomOraclesIds: [],
  hiddenCustomMoveIds: [],
  customStats: [],
  customTracks: {},
};

export function characterSettingsRowToDocument(
  row: CharacterSettingsRow | null | undefined
): SettingsDocument {
  if (!row) {
    return { ...emptySettings };
  }
  return {
    hiddenCustomOraclesIds: row.hidden_custom_oracle_ids ?? [],
    hiddenCustomMoveIds: row.hidden_custom_move_ids ?? [],
    hideDelveMoves: row.hide_delve_moves,
    hideDelveOracles: row.hide_delve_oracles,
    customStats: row.custom_stats ?? [],
    customTracks:
      (row.custom_tracks as SettingsDocument["customTracks"]) ?? {},
  };
}

export function characterSettingsToColumns(
  characterId: string,
  settings: Partial<SettingsDocument>
): Record<string, unknown> {
  const columns: Record<string, unknown> = { character_id: characterId };
  if (settings.customStats !== undefined) {
    columns.custom_stats = settings.customStats;
  }
  if (settings.customTracks !== undefined) {
    columns.custom_tracks = settings.customTracks;
  }
  if (settings.hiddenCustomOraclesIds !== undefined) {
    columns.hidden_custom_oracle_ids = settings.hiddenCustomOraclesIds;
  }
  if (settings.hiddenCustomMoveIds !== undefined) {
    columns.hidden_custom_move_ids = settings.hiddenCustomMoveIds;
  }
  if (settings.hideDelveMoves !== undefined) {
    columns.hide_delve_moves = settings.hideDelveMoves;
  }
  if (settings.hideDelveOracles !== undefined) {
    columns.hide_delve_oracles = settings.hideDelveOracles;
  }
  return columns;
}

export function characterSettingsPayloadToChange(
  payload: PostgresChangePayload<CharacterSettingsRow>
): RowChange<CharacterSettingsRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CharacterSettingsRow>;
    return typeof old.character_id === "string"
      ? { kind: "remove", key: old.character_id }
      : null;
  }
  const row = payload.new as Partial<CharacterSettingsRow>;
  return row && typeof row.character_id === "string"
    ? { kind: "upsert", row: row as CharacterSettingsRow }
    : null;
}

// ---------------------------------------------------------------------------
// Supabase (campaign scope). Campaign settings belong to every member of the
// campaign: members read them, members change them, outsiders see nothing.
// They stream on the campaign's private settings topic.
// ---------------------------------------------------------------------------

export const CAMPAIGN_SETTINGS_TABLE = "campaign_settings";

export interface CampaignSettingsRow {
  campaign_id: string;
  custom_stats: string[];
  custom_tracks: Record<string, unknown>;
  hidden_custom_oracle_ids: string[];
  hidden_custom_move_ids: string[];
  hide_delve_moves: boolean;
  hide_delve_oracles: boolean;
  updated_at: string;
}

export function constructCampaignSettingsChannelName(
  campaignId: string
): string {
  return `campaign:${campaignId}:settings`;
}

export function constructCampaignSettingsFilter(
  campaignId: string
): string {
  return `campaign_id=eq.${campaignId}`;
}

const emptyCampaignSettings: SettingsDocument = {
  hiddenCustomOraclesIds: [],
  hiddenCustomMoveIds: [],
  customStats: [],
  customTracks: {},
};

export function campaignSettingsRowToDocument(
  row: CampaignSettingsRow | null | undefined
): SettingsDocument {
  if (!row) {
    return { ...emptyCampaignSettings };
  }
  return {
    hiddenCustomOraclesIds: row.hidden_custom_oracle_ids ?? [],
    hiddenCustomMoveIds: row.hidden_custom_move_ids ?? [],
    hideDelveMoves: row.hide_delve_moves,
    hideDelveOracles: row.hide_delve_oracles,
    customStats: row.custom_stats ?? [],
    customTracks:
      (row.custom_tracks as SettingsDocument["customTracks"]) ?? {},
  };
}

export function campaignSettingsToColumns(
  campaignId: string,
  settings: Partial<SettingsDocument>
): Record<string, unknown> {
  const columns: Record<string, unknown> = { campaign_id: campaignId };
  if (settings.customStats !== undefined) {
    columns.custom_stats = settings.customStats;
  }
  if (settings.customTracks !== undefined) {
    columns.custom_tracks = settings.customTracks;
  }
  if (settings.hiddenCustomOraclesIds !== undefined) {
    columns.hidden_custom_oracle_ids = settings.hiddenCustomOraclesIds;
  }
  if (settings.hiddenCustomMoveIds !== undefined) {
    columns.hidden_custom_move_ids = settings.hiddenCustomMoveIds;
  }
  if (settings.hideDelveMoves !== undefined) {
    columns.hide_delve_moves = settings.hideDelveMoves;
  }
  if (settings.hideDelveOracles !== undefined) {
    columns.hide_delve_oracles = settings.hideDelveOracles;
  }
  return columns;
}

export function campaignSettingsPayloadToChange(
  payload: PostgresChangePayload<CampaignSettingsRow>
): RowChange<CampaignSettingsRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CampaignSettingsRow>;
    return typeof old.campaign_id === "string"
      ? { kind: "remove", key: old.campaign_id }
      : null;
  }
  const row = payload.new as Partial<CampaignSettingsRow>;
  return row && typeof row.campaign_id === "string"
    ? { kind: "upsert", row: row as CampaignSettingsRow }
    : null;
}
