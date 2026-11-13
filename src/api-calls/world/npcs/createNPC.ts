import { getSupabaseClient } from "config/supabase.config";
import { NPC } from "types/NPCs.type";
import { createApiFunction } from "api-calls/createApiFunction";
import { ensureWorldItemNotes } from "api-calls/world/worldNotes";
import { WORLD_NPCS_TABLE } from "./_getRef";

/**
 * Creates a blank NPC, shared with players by default. Note rows for its
 * public and GM-only notes are created with it, so the note server finds
 * them on first connect.
 */
export const createNPC = createApiFunction<
  { worldId: string; npc?: Partial<NPC> },
  string
>(async (params) => {
  const { worldId, npc } = params;
  const { data, error } = await getSupabaseClient()
    .from(WORLD_NPCS_TABLE)
    .insert({
      world_id: worldId,
      name: npc?.name ?? "New NPC",
      shared_with_players: npc?.sharedWithPlayers ?? true,
      pronouns: npc?.pronouns ?? null,
      species: npc?.species ?? null,
      rank: (npc?.rank ?? null) as unknown as string | null,
      callsign: npc?.callsign ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw error ?? new Error("Failed to create a new npc.");
  }
  const id = (data as { id: string }).id;
  await ensureWorldItemNotes(worldId, "npc", id);
  return id;
}, "Failed to create a new npc.");
