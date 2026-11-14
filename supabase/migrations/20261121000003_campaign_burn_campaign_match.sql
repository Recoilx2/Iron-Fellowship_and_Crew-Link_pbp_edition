-- Burn campaign match: a burn spends only in the speaker's campaign
-- (#127, review round 1, item 3).
--
-- Unlinking a character leaves is_active true, so after unlinking A the
-- player could still burn on A's old rolls in the campaign -- and each
-- burn reset A's momentum. The insert path already ties the speaker to
-- the post's campaign through the insert policy; the UPDATE burn path
-- below gains the same tie: the speaker's campaign must match the burned
-- post's channel campaign, or the burn is refused with the same active-
-- character error.
--
-- This restates 20261121000001 byte-for-byte except the two added
-- campaign lookups and the match check. SECURITY DEFINER and the pinned
-- empty search_path stay, as do the active-character checks.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It sorts after the migration it extends and only replaces the
-- roll lock, which it never edits in place.

BEGIN;

CREATE OR REPLACE FUNCTION public.keep_chat_roll_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  editor uuid;
  burn_text text;
  burn_value integer;
  old_c1 integer;
  old_c2 integer;
  old_result integer;
  new_result integer;
  expected_result integer;
  char_momentum integer;
  char_owner uuid;
  char_active boolean;
  char_camp uuid;
  post_camp uuid;
  old_core jsonb;
  new_core jsonb;
BEGIN
  -- The GM-only flag stays pinned always, so a burn never leaks a secret
  -- roll to players. A lone flag flip with the roll untouched is refused
  -- here alongside every other flag change; no delete or cleanup flow
  -- needs one (see 20261119000000).
  IF OLD.gms_only IS DISTINCT FROM NEW.gms_only THEN
    RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
  END IF;
  IF OLD.roll IS NOT DISTINCT FROM NEW.roll THEN
    RETURN NEW;
  END IF;
  IF OLD.deleted_at IS NULL
    AND NEW.deleted_at IS NOT NULL
    AND NEW.roll IS NULL THEN
    RETURN NEW;
  END IF;
  -- A momentum burn is an UPDATE of a live post's roll only: no deletes,
  -- no flag flips, no text or image changes alongside it.
  IF OLD.deleted_at IS NULL
    AND NEW.deleted_at IS NULL
    AND OLD.roll IS NOT NULL
    AND NEW.roll IS NOT NULL
    AND OLD.speaker_character_id IS NOT NULL
    AND OLD.speaker_npc_id IS NULL
    AND NEW.text IS NOT DISTINCT FROM OLD.text
    AND NEW.image_paths IS NOT DISTINCT FROM OLD.image_paths
    AND NEW.edited_at IS NOT DISTINCT FROM OLD.edited_at
    AND (OLD.roll ->> 'type') = '0'
    AND (NEW.roll ->> 'type') = '0'
    AND (OLD.roll ->> 'momentumBurned') IS NULL
    AND (NEW.roll ->> 'momentumBurned') IS NOT NULL THEN
    editor := (select auth.uid());
    IF OLD.author_id IS DISTINCT FROM editor THEN
      RAISE EXCEPTION 'Chat roll results are immutable: only the author may burn momentum.';
    END IF;
    -- The dice, modifiers, character, timestamp and GM-only detail stay
    -- exactly as posted: only the burn amount and the outcome it earns may
    -- differ, so a dice change without its timestamp change is refused with
    -- every other dice change.
    old_core := OLD.roll - 'momentumBurned' - 'result';
    new_core := NEW.roll - 'momentumBurned' - 'result';
    IF old_core IS DISTINCT FROM new_core THEN
      RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
    END IF;
    -- The burn spends the speaker's whole current momentum: a whole
    -- positive number equal to that character's momentum, and only while
    -- the speaker is the player's active character. Another value, a
    -- fraction, a negative and NaN are all refused here, as is a burn on a
    -- retired character's roll.
    burn_text := NEW.roll ->> 'momentumBurned';
    IF burn_text IS NULL
      OR burn_text !~ '^[0-9]+$'
      OR char_length(burn_text) > 9 THEN
      RAISE EXCEPTION 'Chat roll results are immutable: a momentum burn spends your whole current momentum.';
    END IF;
    burn_value := burn_text::integer;
    SELECT c.momentum, c.owner_id, c.is_active, c.campaign_id INTO char_momentum, char_owner, char_active, char_camp
    FROM public.characters AS c
    WHERE c.id = OLD.speaker_character_id;
    IF NOT FOUND OR char_owner IS DISTINCT FROM editor THEN
      RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your own character.';
    END IF;
    IF NOT char_active THEN
      RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your active character.';
    END IF;
    -- The speaker still plays in the post's campaign: unlinking leaves
    -- is_active true, so without this an old roll stays burnable (and
    -- keeps resetting momentum) after its speaker leaves the campaign.
    -- A missing channel fails closed: NULL never matches.
    SELECT ch.campaign_id INTO post_camp
    FROM public.chat_channels AS ch
    WHERE ch.id = OLD.channel_id;
    IF char_camp IS DISTINCT FROM post_camp THEN
      RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your active character in this campaign.';
    END IF;
    IF burn_value IS DISTINCT FROM char_momentum OR burn_value <= 0 THEN
      RAISE EXCEPTION 'Chat roll results are immutable: a momentum burn spends your whole current momentum.';
    END IF;
    -- The stored outcome is the one the burn earns against the old
    -- challenge dice, and it is strictly better than the posted outcome:
    -- a wrong result and a sideways or downward rewrite are both refused.
    -- Garbage dice fail their casts, which refuses the update the same way.
    old_c1 := (OLD.roll ->> 'challenge1')::integer;
    old_c2 := (OLD.roll ->> 'challenge2')::integer;
    old_result := (OLD.roll ->> 'result')::integer;
    new_result := (NEW.roll ->> 'result')::integer;
    expected_result := private.chat_stat_result(burn_value, old_c1, old_c2);
    IF new_result IS DISTINCT FROM expected_result THEN
      RAISE EXCEPTION 'Chat roll results are immutable: a burned roll carries the outcome its burn earns.';
    END IF;
    IF new_result IS NULL OR old_result IS NULL OR new_result >= old_result THEN
      RAISE EXCEPTION 'Chat roll results are immutable: burning momentum must improve the posted outcome.';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
END;
$$;

DROP TRIGGER IF EXISTS chat_posts_roll_immutable ON public.chat_posts;
CREATE TRIGGER chat_posts_roll_immutable
  BEFORE UPDATE ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION public.keep_chat_roll_immutable();

COMMIT;
