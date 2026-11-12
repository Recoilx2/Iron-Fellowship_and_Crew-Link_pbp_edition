import { getSupabaseClient } from "config/supabase.config";

/**
 * Hocuspocus note server for this stack copy, reached through the API
 * gateway at /hocuspocus/ (see supabase/docker-compose.yml and
 * supabase/envoy/). No new configuration: the websocket URL is derived from
 * the stack URL the site container already bakes in.
 */

export const CHARACTER_NOTES_DOCUMENT_SCOPE = "character-notes";
export const CAMPAIGN_NOTES_DOCUMENT_SCOPE = "campaign-notes";

export function getHocuspocusUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) {
    throw new Error(
      "Supabase is not configured. The site container sets VITE_SUPABASE_URL " +
        "at build time; local development needs it in an .env.local file."
    );
  }
  return (
    base.replace(/\/+$/, "").replace(/^http/, "ws") + "/hocuspocus"
  );
}

export function getCharacterNoteDocumentName(noteId: string): string {
  return `${CHARACTER_NOTES_DOCUMENT_SCOPE}/${noteId}`;
}

export function getCampaignNoteDocumentName(noteId: string): string {
  return `${CAMPAIGN_NOTES_DOCUMENT_SCOPE}/${noteId}`;
}

/**
 * The person's current access token for the note server. Empty when signed
 * out: the server refuses the connection.
 */
export async function getHocuspocusToken(): Promise<string> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session?.access_token ?? "";
}
