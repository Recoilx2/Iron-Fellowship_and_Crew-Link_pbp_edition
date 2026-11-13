-- One character per player per campaign (#109).
--
-- A player has exactly one character in a campaign, so chat never has to ask
-- which character a player posts as. The partial unique index rejects a
-- second row with the same owner in the same campaign; it is partial so solo
-- characters (campaign_id IS NULL) stay unlimited and different players in
-- the same campaign are unaffected. Swapping characters unlinks the old one
-- first, so the index never blocks a swap.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guard below keeps it safe to re-run.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS characters_one_per_player_per_campaign
  ON public.characters (owner_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

COMMIT;
