-- The campaign roll log becomes a view of roll posts (#30).
--
-- Rolls made anywhere else in a campaign -- the character sheet, tracks,
-- oracles -- now land as posts in the campaign's starting IC channel, and
-- the campaign's roll log is read back as a view over those posts
-- (chat_posts rows with a roll), so the separate campaign_rolls collection
-- goes away. There is no production data, so the table is dropped rather
-- than migrated. Solo characters keep their own roll log in
-- character_rolls, which this file leaves alone, as it leaves chat_posts:
-- posted dice stay immutable under the chat rolls trigger (#29).
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guard below keeps it safe to re-run by
-- hand. Dropping the table removes it from the shared live-update
-- publication on its own.

BEGIN;

DROP TABLE IF EXISTS public.campaign_rolls;

COMMIT;
