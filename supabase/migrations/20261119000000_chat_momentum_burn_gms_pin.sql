-- Momentum-burn GM-only pin (#125, part of spec #9).
--
-- The 20261118000000 hardening meant to pin gms_only always, so a burn
-- never leaks a secret roll, but its roll lock waved through a lone flag
-- flip: `OLD.roll IS NOT DISTINCT FROM NEW.roll AND OLD.gms_only IS
-- DISTINCT FROM NEW.gms_only` returned NEW, so a direct `UPDATE chat_posts
-- SET gms_only = ...` with the roll untouched succeeded. This file refuses
-- every gms_only change in the roll-immutable path.
--
-- Verified: no delete or cleanup flow needs a flag change. The delete
-- wrapper (src/api-calls/chat/deletePost.ts) never sends gms_only, the
-- edits trigger's delete branch (20261117000000) leaves it alone, and the
-- 20261115000000 roll lock required it unchanged for deletes. So the pin
-- below covers deletes too: a delete that flips the flag is refused, while
-- the normal delete (flag untouched, roll cleared, marker stamped) still
-- passes.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It sorts after every migration on the branch and only replaces the
-- roll-immutable trigger function, which it never edits in place.
--
-- Standards note: the burn-text guard and speaker-momentum SELECT stay
-- duplicated between keep_chat_roll_immutable() and
-- private.enforce_chat_roll_burn_on_insert() (both from 20261118000000).
-- Sharing them in one helper would cross definer contracts -- the update
-- lock runs as the caller (fail-closed under RLS) while the insert check
-- runs as SECURITY DEFINER -- for ~15 lines saved, so the duplication
-- stays.

BEGIN;

-- Posted dice never change, and the GM-only flag never changes either: the
-- edits trigger runs first (triggers fire alphabetically) and clears the
-- roll beside the text and images, so a cleared roll with the delete marker
-- stamped is the only change waved through for deletes -- and only when the
-- flag is untouched. For burns, the author of a live action roll posted as
-- their own character may set momentumBurned once, with the recalculated
-- result and nothing else: the same dice, modifiers, character, timestamp
-- and GM-only flag, the same text and images, no delete marker. The rest of
-- the burn checks are unchanged from 20261118000000.
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
  -- The GM-only flag stays pinned always, so a burn never leaks a secret
  -- roll to players. A lone flag flip with the roll untouched is refused
  -- here alongside every other flag change; no delete or cleanup flow
  -- needs one (see header).
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

COMMIT;
