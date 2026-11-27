import type { SupabaseClient } from "@supabase/supabase-js";

import type { BroadcastBinding } from "api-calls/realtime/listenToRows";

/**
 * Canonical names of the private topics published by the shared-broadcast
 * triggers (migration 20261128000002). `listenToRows` appends its per-
 * subscription suffix, so callers pass only the canonical value here.
 * The GM family is best-effort for players: its RLS policy denies the join,
 * and `optional` bindings keep that denial out of onError.
 */

export type SharedFamily =
  | "notes"
  | "world"
  | "locations"
  | "npcs"
  | "lore"
  | "chat"
  | "assistant";

export function campaignSharedTopic(
  campaignId: string,
  family: SharedFamily
): string {
  return `campaign-shared:${campaignId}:${family}`;
}

export function campaignGmTopic(
  campaignId: string,
  family: SharedFamily
): string {
  return `campaign-gm:${campaignId}:${family}`;
}

export function channelSharedTopic(channelId: string): string {
  return `channel-shared:${channelId}`;
}

/**
 * Both families for one campaign. The shared family is required (the
 * listener's membership is checked at join); the GM family is optional so a
 * player can keep the shared subscription when the GM one is denied.
 */
export function campaignBroadcastBindings<Row>(
  campaignId: string,
  family: SharedFamily,
  make: () => Omit<
    BroadcastBinding<Row>,
    "type" | "event" | "topic" | "optional"
  >
): Array<BroadcastBinding<Row>> {
  return [
    {
      ...make(),
      type: "broadcast",
      event: "*",
      topic: campaignSharedTopic(campaignId, family),
      optional: false,
    },
    {
      ...make(),
      type: "broadcast",
      event: "*",
      topic: campaignGmTopic(campaignId, family),
      optional: true,
    },
  ];
}

/**
 * Campaigns linked to a world that this reader may see. The campaigns RLS
 * policy only returns campaigns the reader belongs to, which is exactly the
 * set of campaign topics they are allowed to join. A world with no linked
 * campaign has no topic; the reconcile tick keeps those rows current.
 */
export async function campaignIdsForWorld(
  client: SupabaseClient,
  worldId: string
): Promise<string[]> {
  const { data, error } = await client
    .from("campaigns")
    .select("id")
    .eq("world_id", worldId);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

/** The campaign a conversation belongs to (GM-only rows are RLS-filtered). */
export async function campaignIdsForConversation(
  client: SupabaseClient,
  conversationId: string
): Promise<string[]> {
  const { data, error } = await client
    .from("assistant_conversations")
    .select("campaign_id")
    .eq("id", conversationId);
  if (error) throw error;
  return ((data ?? []) as Array<{ campaign_id: string }>).map(
    (row) => row.campaign_id
  );
}

/** Channels a reader may see in a campaign (DMs outside the reader stay out). */
export async function channelIdsForCampaign(
  client: SupabaseClient,
  campaignId: string
): Promise<string[]> {
  const { data, error } = await client
    .from("chat_channels")
    .select("id")
    .eq("campaign_id", campaignId);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}
