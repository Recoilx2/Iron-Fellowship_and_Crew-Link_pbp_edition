import { getSupabaseClient } from "config/supabase.config";
import { GMLocation, Location } from "types/Locations.type";
import { decodeNoteContent } from "api-calls/notes/noteContent";
import {
  getWorldItemNoteIds,
  WORLD_NOTE_CONTENTS_TABLE,
} from "api-calls/world/worldNotes";
import {
  WORLD_LOCATIONS_TABLE,
  WORLD_LOCATION_GM_DETAILS_TABLE,
  locationRowToDocument,
  locationGMDetailsRowToDocument,
  type LocationRow,
  type LocationGMDetailsRow,
} from "./_getRef";

export interface LocationExportRecord {
  id: string;
  doc: Location;
  notes: Uint8Array | null;
  gmNotes: Uint8Array | null;
  gmProperties: Omit<GMLocation, "gmNotes"> | null;
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
 * One-shot bulk read of all location documents (and their sub-documents)
 * for export.
 *
 * - isOwner=true  → reads all locations plus public notes, GM notes, and GM
 *                   properties.
 * - isOwner=false → reads only locations shared with players, and only
 *                   public notes. GM rows are never fetched.
 */
export async function getAllLocationsForExport(
  worldId: string,
  isOwner: boolean
): Promise<LocationExportRecord[]> {
  const client = getSupabaseClient();
  let query = client
    .from(WORLD_LOCATIONS_TABLE)
    .select("*")
    .eq("world_id", worldId);
  if (!isOwner) {
    query = query.eq("shared_with_players", true);
  }
  const { data, error } = await query;
  if (error || !data) {
    if (error) throw error;
    return [];
  }
  const rows = data as unknown as LocationRow[];

  return Promise.all(
    rows.map(async (row): Promise<LocationExportRecord> => {
      const ids = await getWorldItemNoteIds("location", row.id).catch(
        (): { publicNoteId?: string; gmNoteId?: string } => ({})
      );
      const notes = await readNoteBytes(ids.publicNoteId);
      if (!isOwner) {
        return { id: row.id, doc: locationRowToDocument(row), notes, gmNotes: null, gmProperties: null };
      }
      const { data: gmData } = await client
        .from(WORLD_LOCATION_GM_DETAILS_TABLE)
        .select("*")
        .eq("location_id", row.id)
        .maybeSingle();
      const gmNotes = await readNoteBytes(ids.gmNoteId);
      const gmRow = gmData as unknown as LocationGMDetailsRow | null;
      return {
        id: row.id,
        doc: locationRowToDocument(row),
        notes,
        gmNotes,
        gmProperties: gmRow ? locationGMDetailsRowToDocument(gmRow) : null,
      };
    })
  );
}
