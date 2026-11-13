-- Profiles: display names are shown to other players (campaign rosters,
-- avatars, the game log), so every signed-in person may read every profile
-- row. Writes stay owner-only: a person changes only their own display name.
-- This matches the Firebase user documents the profiles table replaces,
-- which were publicly readable; reads stay limited to signed-in people.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards below keep it safe to re-run by hand.

BEGIN;

-- Replace the owner-only read policy: names must reach the whole table.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);

COMMIT;
