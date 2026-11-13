import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "config/supabase.config";
import type { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import type { Roll } from "types/DieRolls.type";
import { CHAT_CHANNELS_TABLE } from "./_getRef";
import {
  CHAT_POSTS_TABLE,
  postRowToLogRoll,
  type PostRow,
} from "./_postRef";

/**
 * The campaign roll log as a view of roll posts (spec #9, ticket #30).
 * Rolls made anywhere in a campaign land in the campaign's starting IC
 * channel, so the log reads chat_posts rows with a roll across every
 * channel of the campaign, newest first with a client-side window. The
 * live filter below keeps text-only posts and other campaigns out;
 * GM-only rolls never reach non-GMs because the database refuses the
 * rows, and the listener skips them as well. The roller of every entry
 * comes from the post's author and speaker columns (postRowToLogRoll),
 * never from the roll JSON, so no stored roll can attribute dice to
 * another character (#120).
 */

export type KnownRollChannels = Set<string>;

/**
 * Reads one live row change into the log's view: roll posts upsert, a
 * soft-deleted post reads as gone from the log, and anything that was
 * never a roll post of this campaign (text-only posts, other campaigns'
 * posts) is ignored.
 */
export function rollPostPayloadToChange(
  knownChannelIds: KnownRollChannels,
  payload: PostgresChangePayload<PostRow>
): RowChange<PostRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<PostRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<PostRow>;
  if (!row || typeof row.id !== "string") {
    return null;
  }
  if (row.channel_id == null || !knownChannelIds.has(row.channel_id)) {
    return null;
  }
  if (row.deleted_at != null) {
    return { kind: "remove", key: row.id };
  }
  if (row.roll == null) {
    return null;
  }
  return { kind: "upsert", row: row as PostRow };
}

export function constructCampaignRollPostsChannelName(
  campaignId: string
): string {
  return `campaign:${campaignId}:rolls`;
}

export async function fetchCampaignRollPosts(
  client: SupabaseClient,
  campaignId: string,
  options: { limit?: number; ascending?: boolean; isGM: boolean }
): Promise<{ channelIds: KnownRollChannels; posts: PostRow[] }> {
  const { data: channels, error: channelsError } = await client
    .from(CHAT_CHANNELS_TABLE)
    .select("id")
    .eq("campaign_id", campaignId);
  if (channelsError) {
    throw channelsError;
  }
  const channelIds: KnownRollChannels = new Set(
    ((channels ?? []) as Array<{ id: string }>).map((row) => row.id)
  );
  if (channelIds.size === 0) {
    return { channelIds, posts: [] };
  }
  let postsQuery = client
    .from(CHAT_POSTS_TABLE)
    .select("*")
    .in("channel_id", [...channelIds])
    .not("roll", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: options.ascending ?? false });
  if (options.limit !== undefined) {
    postsQuery = postsQuery.limit(options.limit);
  }
  if (!options.isGM) {
    postsQuery = postsQuery.eq("gms_only", false);
  }
  const { data, error } = await postsQuery;
  if (error) {
    throw error;
  }
  return { channelIds, posts: (data ?? []) as unknown as PostRow[] };
}

export function listenToCampaignRollPosts(params: {
  campaignId: string;
  totalLogsToLoad: number;
  isGM: boolean;
  updateLog: (postId: string, roll: Roll) => void;
  removeLog: (postId: string) => void;
  onError: (error: string) => void;
}): Unsubscribe {
  const { campaignId, totalLogsToLoad, isGM, updateLog, removeLog, onError } =
    params;

  if (!campaignId) {
    onError("A campaign ID must be defined.");
    return () => {};
  }

  const client = getSupabaseClient();
  // Live events arrive without a channel filter (one binding cannot name
  // every channel of the campaign), so each fetch refreshes the channel
  // set the filter holds; the reconcile re-fetch heals channels created
  // after subscribing.
  let knownChannelIds: KnownRollChannels = new Set();
  let previousIds = new Set<string>();
  return listenToRows<PostRow>({
    client,
    channelName: constructCampaignRollPostsChannelName(campaignId),
    bindings: [
      {
        type: "postgres_changes",
        table: CHAT_POSTS_TABLE,
        toChange: (payload) =>
          rollPostPayloadToChange(knownChannelIds, payload),
      },
    ],
    fetchRows: async () => {
      const { channelIds, posts } = await fetchCampaignRollPosts(client, campaignId, {
        limit: totalLogsToLoad,
        isGM,
      });
      knownChannelIds = channelIds;
      return posts;
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const seen = new Set<string>();
      for (const row of rows) {
        if (!isGM && row.gms_only) {
          continue;
        }
        // The fetch and the live filter only let roll posts through; the
        // guard keeps the type honest if a row ever arrives without one.
        // The roller reads from the post's columns, never the roll JSON.
        const roll = postRowToLogRoll(row);
        if (!roll) {
          continue;
        }
        seen.add(row.id);
        updateLog(row.id, roll);
      }
      for (const id of previousIds) {
        if (!seen.has(id)) {
          removeLog(id);
        }
      }
      previousIds = seen;
    },
    onError: (error) => {
      console.error(error);
      onError("Error getting new logs.");
    },
  });
}
