import type { SupabaseClient } from "@supabase/supabase-js";

import type { BroadcastBinding } from "api-calls/realtime/listenToRows";

/**
 * Canonical names of the private topics published by the shared-broadcast
 * triggers (migration 20261128000002). Broadcast bindings join these names
 * exactly; the GM family is only bound by GMs, since a player's join would
 * be denied by RLS.
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
 * The campaign's shared topic, plus its GM topic only for GMs. A player
 * joining campaign-gm:* is denied by RLS; doing so on every listener burns
 * authorize probes and adds a REST fetch/reconcile for a join that can
 * never succeed. Callers derive `isGM` from the current campaign roster.
 */
export function campaignBroadcastBindings<Row>(
  campaignId: string,
  family: SharedFamily,
  make: () => Omit<
    BroadcastBinding<Row>,
    "type" | "event" | "topic" | "optional"
  >,
  isGM = false
): Array<BroadcastBinding<Row>> {
  const bindings: Array<BroadcastBinding<Row>> = [
    {
      ...make(),
      type: "broadcast",
      event: "*",
      topic: campaignSharedTopic(campaignId, family),
      optional: false,
    },
  ];
  if (isGM) {
    bindings.push({
      ...make(),
      type: "broadcast",
      event: "*",
      topic: campaignGmTopic(campaignId, family),
      optional: true,
    });
  }
  return bindings;
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

/** Campaigns the reader may see (RLS returns only their own campaigns). */
export async function visibleCampaignIds(
  client: SupabaseClient
): Promise<string[]> {
  const { data, error } = await client.from("campaigns").select("id");
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

/** The campaign(s) using the world that owns a world_notes row. */
export async function campaignIdsForWorldNote(
  client: SupabaseClient,
  noteId: string
): Promise<string[]> {
  const { data, error } = await client
    .from("world_notes")
    .select("world_id")
    .eq("id", noteId);
  if (error) throw error;
  const worldIds = ((data ?? []) as Array<{ world_id: string }>).map(
    (row) => row.world_id
  );
  const campaignIds = await Promise.all(
    worldIds.map((worldId) => campaignIdsForWorld(client, worldId))
  );
  return [...new Set(campaignIds.flat())];
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
