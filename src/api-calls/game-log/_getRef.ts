import { Roll } from "types/DieRolls.type";
import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";

// ---------------------------------------------------------------------------
// Supabase (character scope). Solo characters keep their own roll log here;
// the campaign roll log becomes a view of roll posts (chat spec).
// ---------------------------------------------------------------------------

export const CHARACTER_ROLLS_TABLE = "character_rolls";

export interface CharacterRollRow {
  id: string;
  character_id: string;
  roll: Record<string, unknown>;
  gms_only: boolean;
  created_at: string;
  updated_at: string;
}

export function constructCharacterRollsChannelName(
  characterId: string
): string {
  return `character-rolls:${characterId}`;
}

export function constructCharacterRollsFilter(characterId: string): string {
  return `character_id=eq.${characterId}`;
}

export function characterRollRowToRoll(row: CharacterRollRow): Roll {
  const { timestamp, ...rest } = row.roll;
  return {
    ...(rest as unknown as Omit<Roll, "timestamp">),
    timestamp:
      typeof timestamp === "string" ? new Date(timestamp) : new Date(),
  } as Roll;
}

export function characterRollToColumns(
  characterId: string,
  roll: Roll
): Record<string, unknown> {
  return {
    character_id: characterId,
    roll: { ...roll, timestamp: roll.timestamp.toISOString() },
    gms_only: roll.gmsOnly,
  };
}

export function characterRollRowToExportRecord(row: CharacterRollRow): {
  id: string;
  roll: Record<string, unknown>;
} {
  return { id: row.id, roll: { ...row.roll } };
}

export function characterRollPayloadToChange(
  payload: PostgresChangePayload<CharacterRollRow>
): RowChange<CharacterRollRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CharacterRollRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<CharacterRollRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as CharacterRollRow }
    : null;
}

// ---------------------------------------------------------------------------
// Supabase (campaign scope). Campaign rolls belong to every member of the
// campaign, except GM-only rolls, which only GMs read -- enforced by
// row-level security, never by an interface filter. They stream on the
// campaign's private rolls topic.
// ---------------------------------------------------------------------------

export const CAMPAIGN_ROLLS_TABLE = "campaign_rolls";

export interface CampaignRollRow {
  id: string;
  campaign_id: string;
  roll: Record<string, unknown>;
  gms_only: boolean;
  created_at: string;
  updated_at: string;
}

export function constructCampaignRollsChannelName(
  campaignId: string
): string {
  return `campaign:${campaignId}:rolls`;
}

export function constructCampaignRollsFilter(campaignId: string): string {
  return `campaign_id=eq.${campaignId}`;
}

export function campaignRollRowToRoll(row: CampaignRollRow): Roll {
  const { timestamp, ...rest } = row.roll;
  return {
    ...(rest as unknown as Omit<Roll, "timestamp">),
    timestamp:
      typeof timestamp === "string" ? new Date(timestamp) : new Date(),
  } as Roll;
}

export function campaignRollToColumns(
  campaignId: string,
  roll: Roll
): Record<string, unknown> {
  return {
    campaign_id: campaignId,
    roll: { ...roll, timestamp: roll.timestamp.toISOString() },
    gms_only: roll.gmsOnly,
  };
}

export function campaignRollRowToExportRecord(row: CampaignRollRow): {
  id: string;
  roll: Record<string, unknown>;
} {
  return { id: row.id, roll: { ...row.roll } };
}

export function campaignRollPayloadToChange(
  payload: PostgresChangePayload<CampaignRollRow>
): RowChange<CampaignRollRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CampaignRollRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<CampaignRollRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as CampaignRollRow }
    : null;
}
