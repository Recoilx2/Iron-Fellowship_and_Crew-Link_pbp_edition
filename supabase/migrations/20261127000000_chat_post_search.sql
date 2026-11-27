-- Campaign-wide post search (ticket #202, part of spec #200).
--
-- Players lose old posts in a long play-by-post campaign. Search runs in the
-- database over post text: a trigram index speeds up substring matches where
-- the self-hosted image ships pg_trgm, and a plain ILIKE scan where it does
-- not. The index is never required for correctness, only for speed, so a
-- Postgres build without contrib still migrates and still searches.
--
-- The function is deliberately SECURITY INVOKER: the existing
-- chat_posts_select_visible row policy stays the one visibility rule for
-- public channels, private channels, DMs and GM-only posts. Search cannot
-- widen access, because it reads the same rows the feed reads, through the
-- same policy, as the signed-in member. Reading a channel the caller may not
-- see is therefore impossible even for a GM outside a DM.
--
-- Conventions: see supabase/migrations/README.md. This file runs once against
-- an empty database; the guards keep it safe to re-run by hand. It runs after
-- every migration that shapes chat_posts, so the return row matches PostRow.

BEGIN;

-- pg_trgm is not in every Postgres build. A failed CREATE is caught in its
-- own subtransaction so the rest of this migration still applies; searches
-- then fall back to a slower ILIKE scan over the posts table.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm unavailable: chat post search uses a plain ILIKE scan';
  END;
END $$;

-- The GIN trigram index exists only when the operator class does. Discover
-- its schema from pg_extension instead of assuming one: a copy with pg_trgm
-- already installed elsewhere still gets the index, and a copy without it
-- simply keeps the (channel_id, created_at) index the posts table already
-- has.
DO $$
DECLARE trgm_schema text;
BEGIN
  SELECT n.nspname INTO trgm_schema
  FROM pg_extension AS e
  JOIN pg_namespace AS n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF trgm_schema IS NOT NULL THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS chat_posts_text_trgm ON public.chat_posts USING gin (text %I.gin_trgm_ops)',
      trgm_schema
    );
  END IF;
END $$;

-- One campaign's readable, undeleted posts whose text contains the phrase,
-- newest-first with a one-row lookahead past the page. The keyset on
-- (created_at, id) keeps paging stable when posts share a timestamp; a null
-- cursor asks for the first page. The pattern is escaped before it reaches
-- ILIKE so '%' and '_' in a query are literal text, never wildcards, and a
-- blank query matches nothing. p_limit is clamped to 50 results plus the
-- lookahead so a forged request cannot scan an entire campaign.
CREATE OR REPLACE FUNCTION public.search_campaign_posts(
  p_campaign_id uuid,
  p_query text,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS SETOF public.chat_posts
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p.*
  FROM public.chat_posts AS p
  JOIN public.chat_channels AS ch ON ch.id = p.channel_id
  CROSS JOIN LATERAL (
    SELECT nullif(
      replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_'),
      ''
    ) AS pattern
  ) AS q
  WHERE ch.campaign_id = p_campaign_id
    AND p.deleted_at IS NULL
    AND q.pattern IS NOT NULL
    AND p.text ILIKE ('%' || q.pattern || '%') ESCAPE '\'
    AND (
      (p_before_created_at IS NULL AND p_before_id IS NULL)
      OR (
        p_before_created_at IS NOT NULL
        AND p_before_id IS NOT NULL
        AND (p.created_at, p.id) < (p_before_created_at, p_before_id)
      )
    )
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 50) + 1;
$$;

REVOKE EXECUTE ON FUNCTION public.search_campaign_posts(uuid, text, timestamptz, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_campaign_posts(uuid, text, timestamptz, uuid, int) TO authenticated;

COMMIT;
