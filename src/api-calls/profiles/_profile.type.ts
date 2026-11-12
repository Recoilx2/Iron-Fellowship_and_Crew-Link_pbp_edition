/**
 * App-owned profile row. Display names live in the `profiles` table
 * (see supabase/migrations/*_profiles.sql), one row per signed-in person.
 */
export interface Profile {
  id: string;
  displayName: string;
}
