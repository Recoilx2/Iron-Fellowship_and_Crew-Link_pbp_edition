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
import { NoteContentDocument, NoteDocument } from "./_notes.type";

export function constructCampaignNoteCollectionPath(campaignId: string) {
  return `/campaigns/${campaignId}/notes`;
}

export function constructCampaignNoteDocPath(
  campaignId: string,
  noteId: string
) {
  return `/campaigns/${campaignId}/notes/${noteId}`;
}

export function constructCampaignNoteContentPath(
  campaignId: string,
  noteId: string
) {
  return `/campaigns/${campaignId}/notes/${noteId}/content/content`;
}

export function getCampaignNoteCollection(campaignId: string) {
  return collection(
    firestore,
    constructCampaignNoteCollectionPath(campaignId)
  ) as CollectionReference<NoteDocument>;
}

export function getCampaignNoteDocument(campaignId: string, noteId: string) {
  return doc(
    firestore,
    constructCampaignNoteDocPath(campaignId, noteId)
  ) as DocumentReference<NoteDocument>;
}

export function getCampaignNoteContentDocument(
  campaignId: string,
  noteId: string
) {
  return doc(
    firestore,
    constructCampaignNoteContentPath(campaignId, noteId)
  ) as DocumentReference<NoteContentDocument>;
}

export function constructCharacterNoteCollectionPath(characterId: string) {
  return `/characters/${characterId}/notes`;
}

export function constructCharacterNoteDocPath(
  characterId: string,
  noteId: string
) {
  return `/characters/${characterId}/notes/${noteId}`;
}

export function constructCharacterNoteContentPath(
  characterId: string,
  noteId: string
) {
  return `/characters/${characterId}/notes/${noteId}/content/content`;
}

export function getCharacterNoteCollection(characterId: string) {
  return collection(
    firestore,
    constructCharacterNoteCollectionPath(characterId)
  ) as CollectionReference<NoteDocument>;
}

export function getCharacterNoteDocument(characterId: string, noteId: string) {
  return doc(
    firestore,
    constructCharacterNoteDocPath(characterId, noteId)
  ) as DocumentReference<NoteDocument>;
}

export function getCharacterNoteContentDocument(
  characterId: string,
  noteId: string
) {
  return doc(
    firestore,
    constructCharacterNoteContentPath(characterId, noteId)
  ) as DocumentReference<NoteContentDocument>;
}

// ---------------------------------------------------------------------------
// Supabase (character scope). Campaign notes stay on Firebase until the notes
// ticket ports them to server-saved shared editing.
// ---------------------------------------------------------------------------

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
