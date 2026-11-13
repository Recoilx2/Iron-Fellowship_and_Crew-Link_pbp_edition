import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import type { ChannelKind } from "api-calls/chat/_chat.type";

/**
 * Creates a GM's private channel for chosen people. Only GMs of the
 * campaign may create one, and everyone named must already belong to the
 * campaign; the database refuses anything else, and the caller sees the
 * failure. Members and GMs read the new channel live; nobody else does.
 */
export const createPrivateChannel = createApiFunction<
  {
    campaignId: string;
    name: string;
    kind: ChannelKind;
    memberIds: string[];
  },
  string
>(async (params) => {
  const { campaignId, name, kind, memberIds } = params;
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Channel name is required.");
  }
  if (kind !== "IC" && kind !== "OOC") {
    throw new Error("Channel kind must be IC or OOC.");
  }
  const { data, error } = await getSupabaseClient().rpc(
    "create_private_channel",
    {
      cid: campaignId,
      cname: trimmed,
      ckind: kind,
      member_ids: memberIds,
    }
  );
  if (error || typeof data !== "string" || data.length === 0) {
    throw error ?? new Error("Could not create private channel.");
  }
  return data;
}, "Failed to create private channel.");
