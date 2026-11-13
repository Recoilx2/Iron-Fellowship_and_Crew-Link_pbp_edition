import { Roll } from "types/DieRolls.type";
import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";

// ---------------------------------------------------------------------------
// Supabase (character scope). Solo characters keep their own roll log here;
// a campaign's roll log is a view of its chat roll posts (ticket #30).
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
