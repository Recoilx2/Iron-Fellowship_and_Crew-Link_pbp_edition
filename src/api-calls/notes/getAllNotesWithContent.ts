import { getDocs, getDoc, query, where } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  getCampaignNoteCollection,
  getCampaignNoteContentDocument,
  CHARACTER_NOTES_TABLE,
  CHARACTER_NOTE_CONTENTS_TABLE,
  type CharacterNoteRow,
  type CharacterNoteContentRow,
} from "./_getRef";
import { decodeNoteContent } from "./noteContent";
import { NoteDocument } from "./_notes.type";

export interface NoteWithContent {
  noteId: string;
  meta: NoteDocument;
  content: Uint8Array | null;
}

async function getFirebaseNotesWithContent(
  campaignId: string,
  onlyShared?: boolean
): Promise<NoteWithContent[]> {
  const collection = getCampaignNoteCollection(campaignId);

  const notesQuery = onlyShared
    ? query(collection, where("shared", "==", true))
    : collection;

  const snapshot = await getDocs(notesQuery);

  const results = await Promise.all(
    snapshot.docs.map(async (noteDoc): Promise<NoteWithContent> => {
      const noteId = noteDoc.id;
      const meta = noteDoc.data();

      const contentRef = getCampaignNoteContentDocument(campaignId, noteId);

      const contentSnap = await getDoc(contentRef);
      const contentData = contentSnap.data();

      const content = contentData?.notes
        ? (
            contentData.notes as unknown as { toUint8Array(): Uint8Array }
          ).toUint8Array()
        : null;

      return { noteId, meta, content };
    })
  );

  return results;
}

async function getSupabaseNotesWithContent(
  characterId: string,
  onlyShared?: boolean
): Promise<NoteWithContent[]> {
  const client = getSupabaseClient();
  let notesQuery = client
    .from(CHARACTER_NOTES_TABLE)
    .select("*")
    .eq("character_id", characterId);
  if (onlyShared) {
    notesQuery = notesQuery.eq("shared", true);
  }
  const { data: notes, error: notesError } = await notesQuery;
  if (notesError) {
    throw notesError;
  }
  const rows = (notes ?? []) as unknown as CharacterNoteRow[];
  if (rows.length === 0) {
    return [];
  }
  const { data: contents, error: contentsError } = await client
    .from(CHARACTER_NOTE_CONTENTS_TABLE)
    .select("*")
    .in(
      "note_id",
      rows.map((row) => row.id)
    );
  if (contentsError) {
    throw contentsError;
  }
  const contentByNoteId = new Map(
    ((contents ?? []) as unknown as CharacterNoteContentRow[]).map((row) => [
      row.note_id,
      row.content,
    ])
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

  // Campaign notes stay on Firebase until the notes ticket ports them.
  if (source === "campaign") {
    return getFirebaseNotesWithContent(ownerId, onlyShared);
  }

  return getSupabaseNotesWithContent(ownerId, onlyShared);
}
