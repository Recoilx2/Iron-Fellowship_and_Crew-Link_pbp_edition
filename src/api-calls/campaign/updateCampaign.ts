import { getSupabaseClient } from "config/supabase.config";
import { DocumentUpdate } from "api-calls/helpers.type";
import { createApiFunction } from "api-calls/createApiFunction";
import { CampaignDocument } from "api-calls/campaign/_campaign.type";
import {
  CAMPAIGNS_TABLE,
  campaignUpdateToColumns,
  type CampaignRow,
} from "./_getRef";

/**
 * Updates the shared campaign fields. Only members write; the roster and
 * character links belong to their own functions and never change here.
 */
export const updateCampaign = createApiFunction<
  {
    campaignId: string;
    campaign: DocumentUpdate<CampaignDocument>;
  },
  void
>(async (params) => {
  const { campaignId, campaign } = params;
  const client = getSupabaseClient();
  const { data: row, error: fetchError } = await client
    .from(CAMPAIGNS_TABLE)
    .select("*")
    .eq("id", campaignId)
    .single();
  if (fetchError || !row) {
    throw fetchError ?? new Error("Campaign not found");
  }
  const columns = campaignUpdateToColumns(
    row as unknown as CampaignRow,
    campaign
  );
  if (Object.keys(columns).length === 0) {
    return;
  }
  const { data, error } = await client
    .from(CAMPAIGNS_TABLE)
    .update(columns)
    .eq("id", campaignId)
    .select("id");
  if (error || !data || data.length === 0) {
    throw error ?? new Error("Campaign not found");
  }
}, "Failed to update campaign.");
