-- Momentum-burn hardening (#125, part of spec #9).
--
-- The base burn migration lets the author record one momentum burn with its
-- recalculated outcome. Three gaps remain, closed here:
--
--   1. The burn value was never tied to the speaker's momentum: any number
--      (11 against challenge dice of 10 and 10, "NaN", a fraction, a
--      negative) passed with a matching outcome. The roll lock now requires
--      the burn to be a whole positive number equal to the speaker
--      character's current momentum, and the new outcome to be strictly
--      better than the posted one -- a sideways or downward rewrite is
--      refused alongside a wrong result, a GM-only flip, a text change or a
--      dice change in the same update.
--   2. The wrapper reset the character in a second request, so a direct
--      call or a failed second request stranded a burn with its momentum
--      unspent. The burn and the reset now land in one transaction: an
--      AFTER trigger applies the sheet's reset rule the moment a burn is
--      newly recorded, on posted burns and composer sends alike. The
--      composer marks its draft without spending anything; sending posts
--      the burned roll, and the same transaction spends the momentum.
--   3. keep_chat_roll_immutable pins its search_path.
--
-- The reset rule is worked out once here for every burn path: truthy
-- debilities reset to 0 / 1 / the track's starting value of 2, mirroring
-- the sheet (see momentumTrack and the character slice). Scoring mirrors
-- the app's action-roll scoring (see scoreStatRoll): an action total
-- against two challenge dice -- a hit beats both, a miss beats neither.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It sorts after every migration on the branch and only replaces
-- trigger functions, which it never edits in place.

BEGIN;

-- The reset rule, worked out once here for every burn path.
CREATE OR REPLACE FUNCTION private.chat_momentum_reset_for(deb jsonb)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  active integer;
BEGIN
  -- The sheet counts truthy debilities; the values the app writes are
  -- booleans, and anything else counts unless it is an empty-ish literal.
  SELECT count(*) INTO active
  FROM jsonb_each(COALESCE(deb, '{}'::jsonb)) AS d
  WHERE d.value::text NOT IN ('false', 'null', '0', '""', '{}', '[]', '');
  IF active >= 2 THEN
    RETURN 0;
  END IF;
  IF active = 1 THEN
    RETURN 1;
  END IF;
  RETURN 2;
END;
$$;

-- The app's action-roll scoring, worked out once here for the burn checks
-- below: an action total against two challenge dice -- a hit beats both,
-- a miss beats neither, anything else is a weak hit.
CREATE OR REPLACE FUNCTION private.chat_stat_result(total integer, c1 integer, c2 integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN total > c1 AND total > c2 THEN 0
    WHEN total <= c1 AND total <= c2 THEN 2
    ELSE 1
  END;
$$;

-- Posted dice never change, except on soft delete and on a single momentum
-- burn: the edits trigger runs first (triggers fire alphabetically) and
-- clears the roll beside the text and images, so a cleared roll with the
-- delete marker stamped is the only change waved through for deletes. For
-- burns, the author of a live action roll posted as their own character may
-- set momentumBurned once, with the recalculated result and nothing else:
-- the same dice, modifiers, character, timestamp and GM-only flag, the same
-- text and images, no delete marker. The GM-only flag stays pinned always,
-- so a burn never leaks a secret roll to players. The burn spends the
-- speaker's whole current momentum -- a whole positive number equal to the
-- speaker character's momentum -- and the new outcome must be strictly
-- better than the posted one, so a sideways or downward rewrite is refused
-- with the wrong results, flag flips, text changes and dice changes.
CREATE OR REPLACE FUNCTION public.keep_chat_roll_immutable()
RETURNS trigger
LANGUAGE plpgsql
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
  old_core jsonb;
  new_core jsonb;
BEGIN
  IF OLD.roll IS NOT DISTINCT FROM NEW.roll
    AND OLD.gms_only IS DISTINCT FROM NEW.gms_only THEN
    RETURN NEW;
  END IF;
  IF OLD.gms_only IS DISTINCT FROM NEW.gms_only THEN
    RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
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
    -- positive number equal to the speaker character's momentum. Another
    -- value, a fraction, a negative and NaN are all refused here.
    burn_text := NEW.roll ->> 'momentumBurned';
    IF burn_text IS NULL
      OR burn_text !~ '^[0-9]+$'
      OR char_length(burn_text) > 9 THEN
      RAISE EXCEPTION 'Chat roll results are immutable: a momentum burn spends your whole current momentum.';
    END IF;
    burn_value := burn_text::integer;
    SELECT c.momentum, c.owner_id INTO char_momentum, char_owner
    FROM public.characters AS c
    WHERE c.id = OLD.speaker_character_id;
    IF NOT FOUND OR char_owner IS DISTINCT FROM editor THEN
      RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your own character.';
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

-- A composer send may carry its burn with the post: the draft is stamped
-- before sending, and the insert below is what spends the momentum. The
-- same checks as a posted burn apply -- the author's own character, the
-- whole current momentum, the outcome the burn earns -- and the unburned
-- outcome is recomputed the way the app scores it, so the burn must lift
-- the roll instead of standing beside it. Rolls without a burn pass
-- through untouched.
CREATE OR REPLACE FUNCTION private.enforce_chat_roll_burn_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  author uuid;
  burn_text text;
  burn_value integer;
  c1 integer;
  c2 integer;
  stored_result integer;
  expected_result integer;
  action_val integer;
  modifier_val integer;
  adds_val integer;
  unburned_total integer;
  unburned_result integer;
  char_momentum integer;
  char_owner uuid;
BEGIN
  IF NEW.roll IS NULL OR (NEW.roll ->> 'momentumBurned') IS NULL THEN
    RETURN NEW;
  END IF;
  -- A burned roll arrives only on a live action roll posted as the
  -- author's own character: NPC and GM-self voices carry no momentum.
  IF (NEW.roll ->> 'type') IS DISTINCT FROM '0'
    OR NEW.deleted_at IS NOT NULL
    OR NEW.speaker_character_id IS NULL
    OR NEW.speaker_npc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your own character.';
  END IF;
  author := (select auth.uid());
  IF NEW.author_id IS DISTINCT FROM author THEN
    RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your own character.';
  END IF;
  burn_text := NEW.roll ->> 'momentumBurned';
  IF burn_text IS NULL
    OR burn_text !~ '^[0-9]+$'
    OR char_length(burn_text) > 9 THEN
    RAISE EXCEPTION 'Chat roll results are immutable: a momentum burn spends your whole current momentum.';
  END IF;
  burn_value := burn_text::integer;
  SELECT c.momentum, c.owner_id INTO char_momentum, char_owner
  FROM public.characters AS c
  WHERE c.id = NEW.speaker_character_id;
  IF NOT FOUND OR char_owner IS DISTINCT FROM author THEN
    RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your own character.';
  END IF;
  IF burn_value IS DISTINCT FROM char_momentum OR burn_value <= 0 THEN
    RAISE EXCEPTION 'Chat roll results are immutable: a momentum burn spends your whole current momentum.';
  END IF;
  -- The stored outcome is the one the burn earns, and it lifts the roll:
  -- the unburned outcome is recomputed the way the app scores it, so a
  -- wrong result and a useless burn are both refused. Garbage dice fail
  -- their casts, which refuses the insert the same way.
  c1 := (NEW.roll ->> 'challenge1')::integer;
  c2 := (NEW.roll ->> 'challenge2')::integer;
  stored_result := (NEW.roll ->> 'result')::integer;
  expected_result := private.chat_stat_result(burn_value, c1, c2);
  IF stored_result IS DISTINCT FROM expected_result THEN
    RAISE EXCEPTION 'Chat roll results are immutable: a burned roll carries the outcome its burn earns.';
  END IF;
  action_val := (NEW.roll ->> 'action')::integer;
  modifier_val := COALESCE((NEW.roll ->> 'modifier')::integer, 0);
  adds_val := COALESCE((NEW.roll ->> 'adds')::integer, 0);
  unburned_total := LEAST(10, (CASE WHEN (NEW.roll ->> 'matchedNegativeMomentum') = 'true' THEN 0 ELSE action_val END) + modifier_val + adds_val);
  unburned_result := private.chat_stat_result(unburned_total, c1, c2);
  IF stored_result IS NULL OR unburned_result IS NULL OR stored_result >= unburned_result THEN
    RAISE EXCEPTION 'Chat roll results are immutable: burning momentum must improve the posted outcome.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_posts_enforce_roll_burn_on_insert ON public.chat_posts;
CREATE TRIGGER chat_posts_enforce_roll_burn_on_insert
  BEFORE INSERT ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_chat_roll_burn_on_insert();

-- The spend lands with the burn, in the same transaction: whenever a burn
-- is newly recorded -- a posted burn or a composer send carrying one -- the
-- speaker character's momentum resets by the rule above. The BEFORE checks
-- already refused every invalid burn, so this only applies a valid one,
-- and later text edits on a burned post change nothing twice: a burn the
-- old roll already carries is left alone.
CREATE OR REPLACE FUNCTION private.apply_chat_roll_burn_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  reset_value integer;
  updated_count integer;
BEGIN
  IF NEW.roll IS NULL OR (NEW.roll ->> 'momentumBurned') IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.roll ->> 'momentumBurned') IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL OR NEW.speaker_character_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT private.chat_momentum_reset_for(c.debilities) INTO reset_value
  FROM public.characters AS c
  WHERE c.id = NEW.speaker_character_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat roll results are immutable: a momentum burn needs its speaker character.';
  END IF;
  UPDATE public.characters AS c
  SET momentum = reset_value
  WHERE c.id = NEW.speaker_character_id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Chat roll results are immutable: a momentum burn needs its speaker character.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_posts_apply_burn_reset ON public.chat_posts;
CREATE TRIGGER chat_posts_apply_burn_reset
  AFTER INSERT OR UPDATE ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION private.apply_chat_roll_burn_reset();

COMMIT;
