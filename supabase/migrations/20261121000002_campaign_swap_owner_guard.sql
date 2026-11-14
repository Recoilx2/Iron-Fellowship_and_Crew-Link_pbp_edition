-- Swap owner guard: signed-out callers never reach the swap (#127,
-- review round 1, item 1).
--
-- With no JWT, auth.uid() is NULL, so `mine` is NULL and `IF NOT mine`
-- never fires: the SECURITY DEFINER swap ran both UPDATEs anyway. The
-- default EXECUTE grant to PUBLIC (and anon, who holds the public anon
-- key) meant anyone with a character id could retire or reactivate any
-- campaign character.
--
-- This restates set_campaign_character_active byte-for-byte except:
-- - a signed-out caller is refused outright with a privilege error, and
--   the owner check is `IS NOT TRUE` so a NULL comparison can never pass;
-- - EXECUTE is revoked from PUBLIC and anon, keeping the earlier GRANT to
--   authenticated (the only role the app signs in with).
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. It never edits an earlier migration in place.

BEGIN;

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
  IF caller IS NULL THEN
    RAISE EXCEPTION 'sign in to change which character is active' USING ERRCODE = '42501';
  END IF;
  SELECT c.campaign_id, (c.owner_id = caller) INTO camp, mine
  FROM public.characters AS c
  WHERE c.id = char_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'character not found';
  END IF;
  IF mine IS NOT TRUE THEN
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

REVOKE EXECUTE ON FUNCTION public.set_campaign_character_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_campaign_character_active(uuid, boolean) TO authenticated;

COMMIT;
