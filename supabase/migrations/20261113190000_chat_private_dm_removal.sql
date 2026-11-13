-- Removed campaign members keep no private access (#117, part of spec #9).
--
-- Found in the security review of the chat v1 integration: someone removed
-- from a campaign kept reading the private channels and direct messages
-- they were in. The visibility check below gated private and DM reads on
-- the channel roster alone, never on still belonging to the campaign, and
-- leaving or being removed never cleared the roster rows. A related leak:
-- roster rows were hard-deleted while the table sat in the realtime
-- publication with REPLICA IDENTITY FULL, and DELETE events on
-- postgres_changes skip row-level security, so any signed-in subscriber
-- could watch who leaves which private channel -- and whose account
-- deletion clears which direct message.
--
-- Three fixes, in one file, building only on earlier migrations:
--
-- 1. Reading a private or DM channel, and its posts, requires current
--    campaign membership as well as channel membership (or the GM role
--    for private channels). Public channels are unchanged: every member
--    reads them. Everyone named here already belongs to the campaign,
--    because GMs can only name members and members can only DM members.
-- 2. Leaving or being removed from a campaign clears the departing
--    member's roster rows for that campaign's channels. Both paths --
--    the remove_campaign_member function and a member deleting their own
--    roster row to leave -- delete from campaign_members, so the cleanup
--    lives in a trigger on that delete: the caller was already authorized
--    to end the membership, and the cleanup touches only the departing
--    member's rows in that campaign.
-- 3. The roster table leaves the realtime publication, so membership
--    DELETEs stop broadcasting to subscribers outside the channel. No
--    live refresh is lost: every roster write already bumps the parent
--    channel's updated_at, and the roster listener re-fetches on every
--    channel change.
--
-- Conventions: see supabase/migrations/README.md. This file runs once
-- against an empty database; the guards below keep it safe to re-run by
-- hand. Never edit the earlier migrations it builds on.

BEGIN;

-- Private channels belong to their members and the campaign's GMs, direct
-- messages to their two members alone -- and from here on, only while
-- they still belong to the campaign. Someone removed loses access
-- straight away, including live updates, because every read re-checks.
CREATE OR REPLACE FUNCTION private.can_read_channel(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels AS ch
    WHERE ch.id = cid
      AND private.is_campaign_member(ch.campaign_id)
      AND (
        (ch.visibility = 'public')
        OR (ch.visibility = 'private' AND (private.is_channel_member(ch.id) OR private.is_campaign_gm(ch.campaign_id)))
        OR (ch.visibility = 'dm' AND private.is_channel_member(ch.id))
      )
  );
$$;

-- Leaving or being removed ends every private and DM roster row in that
-- campaign: the departed member's reads fail at once, and there is no
-- stale row left for a later rejoin to inherit.
CREATE OR REPLACE FUNCTION private.clear_channel_memberships_on_campaign_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.chat_channel_members AS m
  USING public.chat_channels AS ch
  WHERE m.channel_id = ch.id
    AND ch.campaign_id = OLD.campaign_id
    AND m.user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS chat_channel_members_clear_on_campaign_leave ON public.campaign_members;
CREATE TRIGGER chat_channel_members_clear_on_campaign_leave
  AFTER DELETE ON public.campaign_members
  FOR EACH ROW EXECUTE FUNCTION private.clear_channel_memberships_on_campaign_leave();

-- Roster DELETEs skip row-level security on the way out, so the roster
-- table carries no live stream anymore: any signed-in subscriber could
-- otherwise watch private-channel leaves and DM-ending account deletions
-- from any campaign. The channel bump above keeps every legitimate roster
-- view current through a plain re-fetch.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_channel_members'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_channel_members';
  END IF;
END $$;

COMMIT;
