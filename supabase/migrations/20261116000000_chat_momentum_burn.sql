-- Momentum burn on chat rolls (#125, part of spec #9).
--
-- Chat made posted rolls unchangeable (#29, #30), which hid Burn Momentum
-- everywhere in a campaign. Players may now burn momentum both before and
-- after posting:
--
--   1. Before sending: while an action roll waits in the composer, the
--      player burns momentum on it, then sends the burned result.
--   2. After posting: the roll's author burns momentum on their own posted
--      action roll. The result updates for everyone, live.
--
-- The dice stay unchangeable. The roll lock below keeps its existing rule
-- and its delete exception, and gains one narrow burn exception: the author
-- may record a single momentum burn, together with the outcome that follows
-- from it and nothing else. Every other change to the roll -- the dice,
-- the modifiers, the character, the timestamp, the GM-only flag -- is still
-- refused. Burns are author-only, for their own character, at most once per
-- roll, never on NPC or GM-self voices and never on deleted posts. GM-only
-- rolls stay GM-only after a burn (the flag is pinned).
--
-- The post-text rule is fixed alongside: a live post needs text, images or
-- a roll (per the table CHECK), so clearing the words is allowed when
-- images or a roll remain. Text-only posts still need words.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It sorts after every migration on the branch and only replaces
-- trigger functions, which it never edits in place.

BEGIN;

-- A live post needs text, images or a roll; a soft-deleted post keeps its
-- row with the content cleared (per #27). Clearing the words is allowed
-- only when images or a roll remain; text-only posts still need words.
CREATE OR REPLACE FUNCTION private.enforce_chat_post_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  editor uuid;
  camp uuid;
  editor_is_gm boolean;
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'deleted posts stay deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.channel_id IS DISTINCT FROM OLD.channel_id
    OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.speaker_character_id IS DISTINCT FROM OLD.speaker_character_id
    OR NEW.speaker_npc_id IS DISTINCT FROM OLD.speaker_npc_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only a post''s text and delete marker may change';
  END IF;
  editor := (select auth.uid());
  SELECT ch.campaign_id INTO camp
  FROM public.chat_channels AS ch
  WHERE ch.id = OLD.channel_id;
  editor_is_gm := private.is_campaign_gm(camp);
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    IF NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'deleted posts stay deleted';
    END IF;
    IF OLD.author_id IS DISTINCT FROM editor AND NOT editor_is_gm THEN
      RAISE EXCEPTION 'only the author or a GM may delete a post';
    END IF;
    NEW.deleted_at := now();
    NEW.text := '';
    NEW.image_paths := '{}';
    NEW.roll := NULL;
    NEW.edited_at := OLD.edited_at;
    RETURN NEW;
  END IF;
  IF OLD.author_id IS DISTINCT FROM editor THEN
    RAISE EXCEPTION 'only the author may edit a post';
  END IF;
  NEW.deleted_at := OLD.deleted_at;
  NEW.text := trim(NEW.text);
  IF char_length(NEW.text) = 0
    AND NEW.roll IS NULL
    AND cardinality(NEW.image_paths) = 0 THEN
    RAISE EXCEPTION 'post text is required';
  END IF;
  IF NEW.text IS NOT DISTINCT FROM OLD.text THEN
    NEW.edited_at := OLD.edited_at;
  ELSE
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_posts_enforce_edits ON public.chat_posts;
CREATE TRIGGER chat_posts_enforce_edits
  BEFORE UPDATE ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_chat_post_edits();

-- Posted dice never change, except on soft delete and on a single momentum
-- burn: the edits trigger above runs first and clears the roll beside the
-- text and images, so a cleared roll with the delete marker stamped is the
-- only change waved through for deletes. For burns, the author of a live
-- action roll posted as their own character may set momentumBurned once,
-- with the recalculated result and nothing else: the same dice, modifiers,
-- character, timestamp and GM-only flag, the same text and images, no
-- delete marker. The GM-only flag stays pinned always, so a burn never
-- leaks a secret roll to players.
CREATE OR REPLACE FUNCTION public.keep_chat_roll_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  editor uuid;
  old_burned text;
  new_burned text;
  burned_value numeric;
  old_c1 integer;
  old_c2 integer;
  expected_result integer;
  old_core jsonb;
  new_core jsonb;
BEGIN
  IF OLD.roll IS NOT DISTINCT FROM NEW.roll
    AND OLD.gms_only IS NOT DISTINCT FROM NEW.gms_only THEN
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
      RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
    END IF;
    -- The dice, modifiers, character and timestamp stay exactly as posted:
    -- only the burn amount and the outcome it earns may differ.
    old_core := OLD.roll - 'momentumBurned' - 'result';
    new_core := NEW.roll - 'momentumBurned' - 'result';
    IF old_core IS DISTINCT FROM new_core THEN
      RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
    END IF;
    -- The outcome follows from the burned momentum: beating both challenge
    -- dice is a hit (0), either one a weak hit (1), else the miss stands
    -- (2). The stored result must match the burn.
    BEGIN
      burned_value := (NEW.roll ->> 'momentumBurned')::numeric;
      old_c1 := (OLD.roll ->> 'challenge1')::integer;
      old_c2 := (OLD.roll ->> 'challenge2')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
    END;
    IF burned_value > old_c1 AND burned_value > old_c2 THEN
      expected_result := 0;
    ELSIF burned_value > old_c1 OR burned_value > old_c2 THEN
      expected_result := 1;
    ELSE
      expected_result := 2;
    END IF;
    IF (NEW.roll ->> 'result')::integer IS DISTINCT FROM expected_result THEN
      RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
    END IF;
    -- At most once: the old roll carries no burn, the new one does.
    old_burned := OLD.roll ->> 'momentumBurned';
    new_burned := NEW.roll ->> 'momentumBurned';
    IF old_burned IS NOT NULL OR new_burned IS NULL THEN
      RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Chat roll results are immutable: only the post text may change.';
END $$;

DROP TRIGGER IF EXISTS chat_posts_roll_immutable ON public.chat_posts;
CREATE TRIGGER chat_posts_roll_immutable
  BEFORE UPDATE ON public.chat_posts
  FOR EACH ROW EXECUTE FUNCTION public.keep_chat_roll_immutable();

COMMIT;
