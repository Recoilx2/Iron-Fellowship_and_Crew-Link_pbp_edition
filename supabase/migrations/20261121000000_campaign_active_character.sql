-- Active character: at most one active character per player per campaign
-- (#127, part of spec #9). This reverses #109.
--
-- A character can be retired (made inactive) and reactivated later, so a
-- player keeps any number of characters in a campaign but never plays two
-- at once. Chat still has no character picker: in-character posts and new
-- rolls speak as the player's active character, and momentum burns land
-- only on the active character's rolls.
--
-- - characters gains is_active, defaulting to active. Every row a running
--   database already holds stays active, and the old one-character rule
--   kept those rows to one per player, so the new partial unique index
--   below applies cleanly.
-- - The one-per-player index goes away; a partial unique index refuses a
--   second active row with the same owner in the same campaign. Inactive
--   rows and solo characters (campaign_id IS NULL) stay unlimited.
-- - Only the owner retires or reactivates their character, through
--   set_campaign_character_active below, modelled on
--   unlink_campaign_character: making a character active retires the
--   player's other active characters in the same call.
-- - The chat insert rule names the active character as speaker, and both
--   momentum-burn checks (posted burns and composer sends carrying one)
--   require the speaker to be active right now. Old posts by a retired
--   character keep their speaker columns untouched, so history keeps its
--   names and portraits.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It never edits an earlier migration in place.

BEGIN;

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- At most one active character per player per campaign: the one-per-player
-- rule (#109) refused every second row, while this one refuses only a
-- second active row.
DROP INDEX IF EXISTS public.characters_one_per_player_per_campaign;

CREATE UNIQUE INDEX IF NOT EXISTS characters_one_active_per_player_per_campaign
  ON public.characters (owner_id, campaign_id)
  WHERE campaign_id IS NOT NULL AND is_active;

-- Retiring and reactivating a campaign character. Only the owner may call
-- it, whether or not they GM the campaign; anyone else is refused with a
-- privilege error. Making a character active retires the player's other
-- active characters in the same call, so the swap never trips the index
-- above. Retiring an already inactive character is a no-op. Solo
-- characters (no campaign) have no active character to change.
CREATE OR REPLACE FUNCTION public.set_campaign_character_active(char_id uuid, make_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid;
  camp uuid;
  mine boolean;
BEGIN
  caller := (select auth.uid());
  SELECT c.campaign_id, (c.owner_id = caller) INTO camp, mine
  FROM public.characters AS c
  WHERE c.id = char_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'character not found';
  END IF;
  IF NOT mine THEN
    RAISE EXCEPTION 'only the owner retires or reactivates a character' USING ERRCODE = '42501';
  END IF;
  IF camp IS NULL THEN
    RAISE EXCEPTION 'only a campaign character can be retired or made active';
  END IF;
  IF make_active THEN
    UPDATE public.characters SET is_active = false
    WHERE campaign_id = camp AND owner_id = caller
      AND id IS DISTINCT FROM char_id AND is_active;
    UPDATE public.characters SET is_active = true WHERE id = char_id;
  ELSE
    UPDATE public.characters SET is_active = false WHERE id = char_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_campaign_character_active(uuid, boolean) TO authenticated;

-- Members post into their campaign's open channels as themselves, as their
-- active character in that campaign, or -- GMs alone -- as an NPC from the
-- campaign's world. Naming an inactive character as speaker is refused, so
-- in-character posts always speak as the active character; posting as self
-- (no speaker) stays open, which is how a player with no active character
-- posts out of character. This restates the roll migration's rule with the
-- speaker check narrowed to active characters.
DROP POLICY IF EXISTS "chat_posts_insert_visible" ON public.chat_posts;
CREATE POLICY "chat_posts_insert_visible" ON public.chat_posts
  FOR INSERT TO authenticated WITH CHECK (
    author_id = (select auth.uid())
    AND private.can_read_channel(chat_posts.channel_id)
    AND EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = chat_posts.channel_id
        AND private.is_campaign_member(ch.campaign_id)
        AND NOT ch.archived
    )
    AND (
      speaker_character_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.characters c
        JOIN public.chat_channels ch ON ch.id = chat_posts.channel_id
        WHERE c.id = chat_posts.speaker_character_id
          AND c.owner_id = (select auth.uid())
          AND c.campaign_id = ch.campaign_id
          AND c.is_active
      )
    )
    AND (
      speaker_npc_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.world_npcs npc
        JOIN public.chat_channels ch ON ch.id = chat_posts.channel_id
        JOIN public.campaigns camp ON camp.id = ch.campaign_id
        WHERE npc.id = chat_posts.speaker_npc_id
          AND camp.world_id IS NOT NULL
          AND npc.world_id = camp.world_id
          AND private.is_campaign_gm(ch.campaign_id)
      )
    )
    AND (
      NOT chat_posts.gms_only
      OR EXISTS (
        SELECT 1 FROM public.chat_channels ch
        WHERE ch.id = chat_posts.channel_id
          AND private.is_campaign_gm(ch.campaign_id)
      )
    )
  );

-- Posted dice never change, and the GM-only flag never changes either: the
-- edits trigger runs first (triggers fire alphabetically) and clears the
-- roll beside the text and images, so a cleared roll with the delete marker
-- stamped is the only change waved through for deletes -- and only when the
-- flag is untouched. For burns, the author of a live action roll posted as
-- their active character may set momentumBurned once, with the recalculated
-- result and nothing else: the same dice, modifiers, character, timestamp
-- and GM-only flag, the same text and images, no delete marker. A burn on a
-- roll whose speaker is no longer active is refused: the speaker's whole
-- current momentum is only theirs to spend while they play that character.
-- The rest of the burn checks are unchanged from 20261119000000.
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
  char_active boolean;
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
    SELECT c.momentum, c.owner_id, c.is_active INTO char_momentum, char_owner, char_active
    FROM public.characters AS c
    WHERE c.id = OLD.speaker_character_id;
    IF NOT FOUND OR char_owner IS DISTINCT FROM editor THEN
      RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your own character.';
    END IF;
    IF NOT char_active THEN
      RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your active character.';
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
-- same checks as a posted burn apply -- the author's active character, the
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
  char_active boolean;
BEGIN
  IF NEW.roll IS NULL OR (NEW.roll ->> 'momentumBurned') IS NULL THEN
    RETURN NEW;
  END IF;
  -- A burned roll arrives only on a live action roll posted as the
  -- author's active character: NPC and GM-self voices carry no momentum,
  -- and neither does a retired character.
  IF (NEW.roll ->> 'type') IS DISTINCT FROM '0'
    OR NEW.deleted_at IS NOT NULL
    OR NEW.speaker_character_id IS NULL
    OR NEW.speaker_npc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your active character.';
  END IF;
  author := (select auth.uid());
  IF NEW.author_id IS DISTINCT FROM author THEN
    RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your active character.';
  END IF;
  burn_text := NEW.roll ->> 'momentumBurned';
  IF burn_text IS NULL
    OR burn_text !~ '^[0-9]+$'
    OR char_length(burn_text) > 9 THEN
    RAISE EXCEPTION 'Chat roll results are immutable: a momentum burn spends your whole current momentum.';
  END IF;
  burn_value := burn_text::integer;
  SELECT c.momentum, c.owner_id, c.is_active INTO char_momentum, char_owner, char_active
  FROM public.characters AS c
  WHERE c.id = NEW.speaker_character_id;
  IF NOT FOUND OR char_owner IS DISTINCT FROM author THEN
    RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your active character.';
  END IF;
  IF NOT char_active THEN
    RAISE EXCEPTION 'Chat roll results are immutable: momentum burns only on your active character.';
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

COMMIT;
