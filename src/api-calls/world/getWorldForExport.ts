import { getSupabaseClient } from "config/supabase.config";
import { World } from "./_world.type";
import { WORLDS_TABLE, worldRowToDocument, type WorldRow } from "./_getRef";

/**
 * One-shot read of a world row for export. Returns the document stores
 * read, or null when the person may not see the world.
 */
export async function getWorldForExport(
  worldId: string
): Promise<World | null> {
  const { data, error } = await getSupabaseClient()
    .from(WORLDS_TABLE)
    .select("*")
    .eq("id", worldId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return worldRowToDocument(data as unknown as WorldRow);
}
