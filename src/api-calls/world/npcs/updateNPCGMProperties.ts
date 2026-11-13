import { getSupabaseClient } from "config/supabase.config";
import { GMNPC } from "types/NPCs.type";
import { createApiFunction } from "api-calls/createApiFunction";
import { WORLD_NPC_GM_DETAILS_TABLE } from "./_getRef";

interface Params {
  worldId: string;
  npcId: string;
  npcGMProperties: Partial<GMNPC>;
}

/**
 * Saves the structured GM-only fields of an NPC. GM notes travel through
 * the GM-only world note instead. Only world GMs may write; the database
 * enforces it.
 */
export const updateNPCGMProperties = createApiFunction<Params, void>(
  async (params) => {
    const { npcId, npcGMProperties } = params;
    const client = getSupabaseClient();
    const { data, error: readError } = await client
      .from(WORLD_NPC_GM_DETAILS_TABLE)
      .select("*")
      .eq("npc_id", npcId)
      .maybeSingle();
    if (readError) {
      throw readError;
    }
    const current = (data ?? {}) as {
      goal?: string | null;
      role?: string | null;
      descriptor?: string | null;
      disposition?: string | null;
      activity?: string | null;
      first_look?: string | null;
      revealed_aspect?: string | null;
    };
    const { data: upserted, error } = await client
      .from(WORLD_NPC_GM_DETAILS_TABLE)
      .upsert({
        npc_id: npcId,
        goal: npcGMProperties.goal ?? current.goal ?? null,
        role: npcGMProperties.role ?? current.role ?? null,
        descriptor: npcGMProperties.descriptor ?? current.descriptor ?? null,
        disposition:
          npcGMProperties.disposition ?? current.disposition ?? null,
        activity: npcGMProperties.activity ?? current.activity ?? null,
        first_look:
          npcGMProperties.firstLook ?? current.first_look ?? null,
        revealed_aspect:
          npcGMProperties.revealedAspect ?? current.revealed_aspect ?? null,
      })
      .select("npc_id");
    if (error || !upserted || upserted.length === 0) {
      throw error ?? new Error("Failed to update npc.");
    }
  },
  "Failed to update npc."
);
