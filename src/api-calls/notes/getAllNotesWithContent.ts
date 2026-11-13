import { getSupabaseClient } from "config/supabase.config";
import {
  CHARACTER_NOTES_TABLE,
  CHARACTER_NOTE_CONTENTS_TABLE,
  CAMPAIGN_NOTES_TABLE,
  CAMPAIGN_NOTE_CONTENTS_TABLE,
  type CharacterNoteRow,
  type CharacterNoteContentRow,
  type CampaignNoteRow,
  type CampaignNoteContentRow,
} from "./_getRef";
import { decodeNoteContent } from "./noteContent";
import { NoteDocument } from "./_notes.type";

export interface NoteWithContent {
  noteId: string;
  meta: NoteDocument;
  content: Uint8Array | null;
}

interface NotesTables {
  notesTable: string;
  contentsTable: string;
  parentColumn: string;
}

const CHARACTER_TABLES: NotesTables = {
  notesTable: CHARACTER_NOTES_TABLE,
  contentsTable: CHARACTER_NOTE_CONTENTS_TABLE,
  parentColumn: "character_id",
};

const CAMPAIGN_TABLES: NotesTables = {
  notesTable: CAMPAIGN_NOTES_TABLE,
  contentsTable: CAMPAIGN_NOTE_CONTENTS_TABLE,
  parentColumn: "campaign_id",
};

async function getSupabaseNotesWithContent(
  tables: NotesTables,
  parentId: string,
  onlyShared?: boolean
): Promise<NoteWithContent[]> {
  const client = getSupabaseClient();
  let notesQuery = client
    .from(tables.notesTable)
    .select("*")
    .eq(tables.parentColumn, parentId);
  if (onlyShared) {
    notesQuery = notesQuery.eq("shared", true);
  }
  const { data: notes, error: notesError } = await notesQuery;
  if (notesError) {
    throw notesError;
  }
  const rows = (notes ?? []) as unknown as Array<
    CharacterNoteRow | CampaignNoteRow
  >;
  if (rows.length === 0) {
    return [];
  }
  const { data: contents, error: contentsError } = await client
    .from(tables.contentsTable)
    .select("*")
    .in(
      "note_id",
      rows.map((row) => row.id)
    );
  if (contentsError) {
    throw contentsError;
  }
  const contentByNoteId = new Map(
    (
      (contents ?? []) as unknown as Array<
        CharacterNoteContentRow | CampaignNoteContentRow
      >
    ).map((row) => [row.note_id, row.content])
  );
  return rows.map((row) => {
    const content = contentByNoteId.get(row.id);
    return {
      noteId: row.id,
      meta: { title: row.title, order: row.sort_order, shared: row.shared },
      content: content ? decodeNoteContent(content) : null,
    };
  });
}

export async function getAllNotesWithContent(params: {
  source: "campaign" | "character";
  ownerId: string;
  onlyShared?: boolean;
}): Promise<NoteWithContent[]> {
  const { source, ownerId, onlyShared } = params;

  return getSupabaseNotesWithContent(
    source === "campaign" ? CAMPAIGN_TABLES : CHARACTER_TABLES,
    ownerId,
    onlyShared
  );
}
