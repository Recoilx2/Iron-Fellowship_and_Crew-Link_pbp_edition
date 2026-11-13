import { getSupabaseClient } from "config/supabase.config";
import { Lore } from "types/Lore.type";
import { decodeNoteContent } from "api-calls/notes/noteContent";
import {
  getWorldItemNoteIds,
  WORLD_NOTE_CONTENTS_TABLE,
} from "api-calls/world/worldNotes";
import { WORLD_LORE_TABLE, loreRowToDocument, type LoreRow } from "./_getRef";

export interface LoreExportRecord {
  id: string;
  doc: Lore;
  notes: Uint8Array | null;
  gmNotes: Uint8Array | null;
}

async function readNoteBytes(noteId: string | undefined): Promise<Uint8Array | null> {
  if (!noteId) return null;
  const { data, error } = await getSupabaseClient()
    .from(WORLD_NOTE_CONTENTS_TABLE)
    .select("content")
    .eq("note_id", noteId)
    .maybeSingle();
  if (error || !data) return null;
  const content = (data as { content: string | null }).content;
  if (!content) return null;
  try {
    return decodeNoteContent(content);
  } catch {
    return null;
  }
}

/**
 * One-shot bulk read of all lore documents (and their notes) for export.
 *
 * - isOwner=true  → reads all lore plus public notes and GM notes.
 * - isOwner=false → reads only lore shared with players, and only public
 *                   notes. GM notes are never fetched.
 */
export async function getAllLoreForExport(
  worldId: string,
  isOwner: boolean
): Promise<LoreExportRecord[]> {
  const client = getSupabaseClient();
  let query = client.from(WORLD_LORE_TABLE).select("*").eq("world_id", worldId);
  if (!isOwner) {
    query = query.eq("shared_with_players", true);
  }
  const { data, error } = await query;
  if (error || !data) {
    if (error) throw error;
    return [];
  }
  const rows = data as unknown as LoreRow[];

  return Promise.all(
    rows.map(async (row): Promise<LoreExportRecord> => {
      const ids = await getWorldItemNoteIds("lore", row.id).catch(
        (): { publicNoteId?: string; gmNoteId?: string } => ({})
      );
      const notes = await readNoteBytes(ids.publicNoteId);
      const gmNotes = isOwner ? await readNoteBytes(ids.gmNoteId) : null;
      return {
        id: row.id,
        doc: loreRowToDocument(row),
        notes,
        gmNotes,
      };
    })
  );
}
