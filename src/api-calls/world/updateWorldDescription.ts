import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { encodeNoteContent } from "api-calls/notes/noteContent";
import { WORLDS_TABLE } from "./_getRef";

/**
 * Saves the world description bytes beside the world row. The note server
 * owns the live document (the world-descriptions scope) and writes the
 * same column on its debounce; this write is the fallback path and the
 * initial value for fresh documents. Only world GMs may write; the
 * database enforces it.
 */
export const updateWorldDescription = createApiFunction<
  {
    worldId: string;
    description: Uint8Array;
    isBeaconRequest?: boolean;
  },
  void
>(async (params) => {
  const { worldId, description, isBeaconRequest } = params;
  const client = getSupabaseClient();
  const encoded = encodeNoteContent(description);

  // Closing the page: send the write with keepalive instead of the client,
  // which the browser may cancel mid-flight.
  if (isBeaconRequest) {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
      | string
      | undefined;
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!url || !anonKey || !token) {
      return;
    }
    await fetch(`${url}/rest/v1/${WORLDS_TABLE}?id=eq.${worldId}`, {
      method: "PATCH",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ description: encoded }),
      keepalive: true,
    });
    return;
  }

  const { data: updated, error } = await client
    .from(WORLDS_TABLE)
    .update({ description: encoded })
    .eq("id", worldId)
    .select("id");
  if (error || !updated || updated.length === 0) {
    throw error ?? new Error("Failed to update world description.");
  }
}, "Failed to update world description.");
