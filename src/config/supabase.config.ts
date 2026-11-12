import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for the deployed stack. Created lazily so importing this
 * module never touches the network; the site container bakes the URL and
 * anon key in at build time (see supabase/site/).
 */

let cachedClient: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (!cachedClient) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error(
        "Supabase is not configured. The site container sets VITE_SUPABASE_URL " +
          "and VITE_SUPABASE_ANON_KEY at build time; local development needs " +
          "them in an .env.local file."
      );
    }
    cachedClient = createClient(url, anonKey);
  }
  return cachedClient;
}
