import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CAMPAIGN_NOTES_TABLE } from "./_getRef";

/**
 * The campaign outline (ticket #131): one GM-only `outline` row per
 * campaign holding the planned story, edited in the assistant panel's
 * Outline tab with the same editor as other notes. It is created the first
 * time a GM opens it and shared by all of the campaign's GMs; players can
 * neither read nor write it (the access rules hide it, and it is never
 * shared). The database refuses a second outline per campaign and any
 * attempt to share it, so a lost creation race against a co-GM surfaces as
 * a unique violation, which re-reads the winner's row.
 */
export const getOrCreateCampaignOutline = createApiFunction<
  { campaignId: string },
  string
>(async (params) => {
  const { campaignId } = params;
  if (!campaignId || campaignId.trim().length === 0) {
    throw new Error("A campaign is required to open the outline.");
  }
  const client = getSupabaseClient();

  const readOutline = async (): Promise<string | null> => {
    const { data, error } = await client
      .from(CAMPAIGN_NOTES_TABLE)
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("kind", "outline")
      .maybeSingle();
    if (error) {
      throw error;
    }
    const id: unknown = (data as { id?: unknown } | null)?.id;
    return typeof id === "string" ? id : null;
  };

  const existing = await readOutline();
  if (existing) {
    return existing;
  }

  // The id is generated here so the insert needs no RETURNING clause: the
  // notes SELECT policy re-queries its own table, which cannot see a
  // just-inserted row in the same statement, so insert-then-select always
  // fails RLS (#69). The plain INSERT policy compares ownership directly
  // and accepts the row; non-GMs fail it because outlines are GM-only.
  const id = crypto.randomUUID();
  const { error: insertError } = await client
    .from(CAMPAIGN_NOTES_TABLE)
    .insert({
      id,
      campaign_id: campaignId,
      kind: "outline",
      title: "Campaign outline",
      shared: false,
      sort_order: 0,
    });
  if (!insertError) {
    return id;
  }
  if ((insertError as { code?: string }).code === "23505") {
    const winner = await readOutline();
    if (winner) {
      return winner;
    }
  }
  throw insertError;
}, "Failed to open the campaign outline.");
