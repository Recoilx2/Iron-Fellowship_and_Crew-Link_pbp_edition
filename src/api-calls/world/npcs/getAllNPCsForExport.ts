import { getSupabaseClient } from "config/supabase.config";
import { GMNPC, NPC } from "types/NPCs.type";
import { decodeNoteContent } from "api-calls/notes/noteContent";
import {
  getWorldItemNoteIds,
  WORLD_NOTE_CONTENTS_TABLE,
} from "api-calls/world/worldNotes";
import {
  WORLD_NPCS_TABLE,
  WORLD_NPC_GM_DETAILS_TABLE,
  npcRowToDocument,
  npcGMDetailsRowToDocument,
  type NPCRow,
  type NPCGMDetailsRow,
} from "./_getRef";

export interface NPCExportRecord {
  id: string;
  doc: NPC;
  notes: Uint8Array | null;
  gmNotes: Uint8Array | null;
  gmProperties: Omit<GMNPC, "gmNotes"> | null;
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
 * One-shot bulk read of all NPC documents (and their sub-documents) for
 * export.
 *
 * - isOwner=true  → reads all NPCs plus public notes, GM notes, and GM
 *                   properties.
 * - isOwner=false → reads only NPCs shared with players, and only public
 *                   notes. GM rows are never fetched.
 */
export async function getAllNPCsForExport(
  worldId: string,
  isOwner: boolean
): Promise<NPCExportRecord[]> {
  const client = getSupabaseClient();
  let query = client.from(WORLD_NPCS_TABLE).select("*").eq("world_id", worldId);
  if (!isOwner) {
    query = query.eq("shared_with_players", true);
  }
  const { data, error } = await query;
  if (error || !data) {
    if (error) throw error;
    return [];
  }
  const rows = data as unknown as NPCRow[];

  return Promise.all(
    rows.map(async (row): Promise<NPCExportRecord> => {
      const ids = await getWorldItemNoteIds("npc", row.id).catch(
        (): { publicNoteId?: string; gmNoteId?: string } => ({})
      );
      const notes = await readNoteBytes(ids.publicNoteId);
      if (!isOwner) {
        return {
          id: row.id,
          doc: npcRowToDocument(row),
          notes,
          gmNotes: null,
          gmProperties: null,
        };
      }
      const { data: gmData } = await client
        .from(WORLD_NPC_GM_DETAILS_TABLE)
        .select("*")
        .eq("npc_id", row.id)
        .maybeSingle();
      const gmNotes = await readNoteBytes(ids.gmNoteId);
      const gmRow = gmData as unknown as NPCGMDetailsRow | null;
      return {
        id: row.id,
        doc: npcRowToDocument(row),
        notes,
        gmNotes,
        gmProperties: gmRow ? npcGMDetailsRowToDocument(gmRow) : null,
      };
    })
  );
}
