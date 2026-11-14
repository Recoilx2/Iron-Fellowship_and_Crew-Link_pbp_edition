-- Chat roll-lock definer and own-post upload fix (#125, #118, part of spec #9).
--
-- Two independent failures from run 43545386704 on b1215b14, fixed here.
--
--   1. Momentum burns fail with `permission denied for schema private`.
--      public.keep_chat_roll_immutable() ran as SECURITY INVOKER and its
--      burn check calls private.chat_stat_result(), which app roles may not
--      reach: no grant ever gives them the private schema, and none ever
--      will (see the invariant test). The lock below is the 20261119000000
--      function byte-for-byte with SECURITY DEFINER added, so it crosses
--      only the schema-USAGE boundary: authorship is still enforced by the
--      function's own auth.uid() checks (author row, speaker ownership),
--      the dice stay pinned, the outcome must improve, and the GM-only flag
--      stays pinned. The pinned empty search_path stays, so the definer
--      elevation cannot be steered at name-resolution time.
--
--   2. An author's top-up upload into their own existing post folder is
--      refused with a row-level-security violation. Inside the INSERT
--      author-branch EXISTS added in 20261117000000, the bare `name`
--      resolves to chat_channels.name (the channel's display name) instead
--      of storage.objects.name (the file path): the inner query's tables
--      shadow the policy target. chat_image_post()/chat_image_campaign()
--      then parse NULL, so the branch never matches -- nobody tops up
--      anyone's post, including the author. The policy below is the
--      20261117000000 one with every path reference qualified as
--      storage.objects.name, the style 20261114000000 already used.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It sorts after every migration on the branch and only replaces the
-- roll lock and the storage INSERT policy, which it never edits in place.

BEGIN;

-- Fix 1: the roll lock runs as definer past the schema boundary; every
-- check inside is unchanged from 20261119000000.

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


-- Fix 2: qualify the file path inside the author-branch EXISTS so the
-- channel's display-name column can no longer shadow it. Members upload
-- only into a folder for a post that does not exist yet (the composer's
-- pending upload) or for a post they authored, in a campaign they belong
-- to. The no-post check reads through a security definer helper: row
-- visibility narrows per reader, and a plain NOT EXISTS would mistake
-- another member's hidden post for "not yet posted".
DROP POLICY IF EXISTS "chat_images_insert_members" ON storage.objects;
CREATE POLICY "chat_images_insert_members" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'chat-images'
    AND private.chat_image_campaign(storage.objects.name) IS NOT NULL
    AND private.chat_image_post(storage.objects.name) IS NOT NULL
    AND private.is_campaign_member(private.chat_image_campaign(storage.objects.name))
    AND (
      NOT private.chat_post_exists(private.chat_image_post(storage.objects.name))
      OR EXISTS (
        SELECT 1
        FROM public.chat_posts AS p
        JOIN public.chat_channels AS ch ON ch.id = p.channel_id
        WHERE p.id = private.chat_image_post(storage.objects.name)
          AND ch.campaign_id = private.chat_image_campaign(storage.objects.name)
          AND p.author_id = (select auth.uid())
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

COMMIT;
