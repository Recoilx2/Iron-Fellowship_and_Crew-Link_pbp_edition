import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import type {
  AssistantContextChoice,
  AssistantSettingsDocument,
} from "./_assistant.type";
import {
  ASSISTANT_SETTINGS_TABLE,
  settingsDocumentToColumns,
  settingsRowToDocument,
  type AssistantSettingsRow,
} from "./_getRef";

/**
 * Reads the signed-in GM's assistant settings for a campaign: the chosen
 * model and the saved context choice. Null until the GM saves a choice.
 * Other GMs' rows never match, so each GM's choice stays private.
 */
export const fetchAssistantSettings = createApiFunction<
  { campaignId: string },
  AssistantSettingsDocument | null
>(async (params) => {
  const { campaignId } = params;
  if (!campaignId || campaignId.trim().length === 0) {
    throw new Error("A campaign is required to read settings.");
  }
  const { data: sessionData, error: sessionError } =
    await getSupabaseClient().auth.getSession();
  const gmId = sessionData.session?.user.id;
  if (sessionError || !gmId) {
    throw sessionError ?? new Error("You must be logged in to read settings.");
  }
  const { data, error } = await getSupabaseClient()
    .from(ASSISTANT_SETTINGS_TABLE)
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("gm_id", gmId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return settingsRowToDocument(data as unknown as AssistantSettingsRow);
}, "Failed to read assistant settings.");

/**
 * Saves the signed-in GM's assistant settings for a campaign: the chosen
 * model (or null to clear it) beside the saved context choice, which
 * carries references only, never text. One row per (campaign, GM); saving
 * again replaces the GM's own row, never another GM's.
 */
export const saveAssistantSettings = createApiFunction<
  { campaignId: string; model: string | null; context: AssistantContextChoice },
  void
>(async (params) => {
  const { campaignId, model, context } = params;
  if (!campaignId || campaignId.trim().length === 0) {
    throw new Error("A campaign is required to save settings.");
  }
  const { data: sessionData, error: sessionError } =
    await getSupabaseClient().auth.getSession();
  const gmId = sessionData.session?.user.id;
  if (sessionError || !gmId) {
    throw sessionError ?? new Error("You must be logged in to save settings.");
  }
  const trimmedModel = (model ?? "").trim();
  const { error } = await getSupabaseClient()
    .from(ASSISTANT_SETTINGS_TABLE)
    .upsert(
      {
        campaign_id: campaignId,
        gm_id: gmId,
        ...settingsDocumentToColumns({
          model: trimmedModel.length > 0 ? trimmedModel : null,
          context,
        }),
      },
      { onConflict: "campaign_id,gm_id" }
    );
  if (error) {
    throw error;
  }
}, "Failed to save assistant settings.");
