import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";

export const CHARACTER_NOTES_TABLE = "character_notes";
export const CHARACTER_NOTE_CONTENTS_TABLE = "character_note_contents";

export interface CharacterNoteRow {
  id: string;
  character_id: string;
  title: string;
  shared: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CharacterNoteContentRow {
  note_id: string;
  content: string | null;
  updated_at: string;
}

export function constructCharacterNotesChannelName(
  characterId: string
): string {
  return `character-notes:${characterId}`;
}

export function constructCharacterNotesFilter(characterId: string): string {
  return `character_id=eq.${characterId}`;
}

export function constructCharacterNoteContentChannelName(
  noteId: string
): string {
  return `character-note-content:${noteId}`;
}

export function constructCharacterNoteContentFilter(noteId: string): string {
  return `note_id=eq.${noteId}`;
}

export function characterNotePayloadToChange(
  payload: PostgresChangePayload<CharacterNoteRow>
): RowChange<CharacterNoteRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CharacterNoteRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<CharacterNoteRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as CharacterNoteRow }
    : null;
}

export function characterNoteContentPayloadToChange(
  payload: PostgresChangePayload<CharacterNoteContentRow>
): RowChange<CharacterNoteContentRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CharacterNoteContentRow>;
    return typeof old.note_id === "string"
      ? { kind: "remove", key: old.note_id }
      : null;
  }
  const row = payload.new as Partial<CharacterNoteContentRow>;
  return row && typeof row.note_id === "string"
    ? { kind: "upsert", row: row as CharacterNoteContentRow }
    : null;
}

export const CAMPAIGN_NOTES_TABLE = "campaign_notes";
export const CAMPAIGN_NOTE_CONTENTS_TABLE = "campaign_note_contents";

export interface CampaignNoteRow {
  id: string;
  campaign_id: string;
  title: string;
  shared: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignNoteContentRow {
  note_id: string;
  content: string | null;
  updated_at: string;
}

export function constructCampaignNotesChannelName(
  campaignId: string
): string {
  return `campaign-notes:${campaignId}`;
}

export function constructCampaignNotesFilter(campaignId: string): string {
  return `campaign_id=eq.${campaignId}`;
}

export function constructCampaignNoteContentChannelName(
  noteId: string
): string {
  return `campaign-note-content:${noteId}`;
}

export function constructCampaignNoteContentFilter(noteId: string): string {
  return `note_id=eq.${noteId}`;
}

export function campaignNotePayloadToChange(
  payload: PostgresChangePayload<CampaignNoteRow>
): RowChange<CampaignNoteRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CampaignNoteRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<CampaignNoteRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as CampaignNoteRow }
    : null;
}

export function campaignNoteContentPayloadToChange(
  payload: PostgresChangePayload<CampaignNoteContentRow>
): RowChange<CampaignNoteContentRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CampaignNoteContentRow>;
    return typeof old.note_id === "string"
      ? { kind: "remove", key: old.note_id }
      : null;
  }
  const row = payload.new as Partial<CampaignNoteContentRow>;
  return row && typeof row.note_id === "string"
    ? { kind: "upsert", row: row as CampaignNoteContentRow }
    : null;
}
