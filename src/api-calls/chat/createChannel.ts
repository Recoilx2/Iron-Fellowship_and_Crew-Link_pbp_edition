import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import type { ChannelKind } from "api-calls/chat/_chat.type";
import { CHAT_CHANNELS_TABLE } from "./_getRef";

/**
 * Creates a channel in a campaign. Only GMs of the campaign may create
 * channels; everyone else fails on the channel access rules. The starting
 * IC and OOC channels already exist: creating a campaign made them.
 */
export const createChannel = createApiFunction<
  { campaignId: string; name: string; kind: ChannelKind },
  string
>(async (params) => {
  const { campaignId, name, kind } = params;
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Channel name is required.");
  }
  if (kind !== "IC" && kind !== "OOC") {
    throw new Error("Channel kind must be IC or OOC.");
  }
  // The id is generated here so the insert needs no RETURNING clause,
  // matching the notes convention: later channel rules (private channels)
  // re-query their own table and would fail insert-then-select RLS.
  const id = crypto.randomUUID();
  const { error } = await getSupabaseClient().from(CHAT_CHANNELS_TABLE).insert({
    id,
    campaign_id: campaignId,
    name: trimmed,
    kind,
  });
  if (error) {
    throw error;
  }
  return id;
}, "Failed to create channel.");
