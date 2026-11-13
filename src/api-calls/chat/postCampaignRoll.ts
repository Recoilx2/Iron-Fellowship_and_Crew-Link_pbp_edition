import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import type { Roll } from "types/DieRolls.type";
import { CHAT_CHANNELS_TABLE } from "./_getRef";
import { createPost } from "./createPost";

/**
 * Posts a roll made elsewhere in a campaign -- the character sheet, tracks,
 * oracles -- to the campaign's starting IC channel (spec #9, ticket #30).
 * The roll keeps its existing shape and GM-only flag, so the existing roll
 * display renders it and the database keeps hiding secrets from players.
 * The caller picks the speaker the way the composer does: the author's
 * campaign character in character, nobody (the author themselves) out of
 * it. A roll-only post carries empty text. The roll's identity is stamped
 * from the post -- the author's uid and the speaker character -- because a
 * sheet roll carries its open sheet's character, which may not be the
 * post's speaker, and the database binds a posted roll to its post (#120).
 */
export const postCampaignRoll = createApiFunction<
  {
    campaignId: string;
    speakerCharacterId?: string | null;
    roll: Roll;
  },
  string
>(async (params) => {
  const { campaignId, speakerCharacterId, roll } = params;

  if (!campaignId) {
    throw new Error("A campaign is required to post its roll.");
  }
  if (!roll) {
    throw new Error("A roll is required to post.");
  }

  const { data: sessionData, error: sessionError } =
    await getSupabaseClient().auth.getSession();
  const authorId = sessionData.session?.user.id;
  if (sessionError || !authorId) {
    throw sessionError ?? new Error("You must be logged in to post.");
  }

  const { data, error } = await getSupabaseClient()
    .from(CHAT_CHANNELS_TABLE)
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("kind", "IC")
    .eq("is_starting", true)
    .limit(1)
    .single();
  if (error || !data) {
    throw error ?? new Error("The campaign has no in-character channel.");
  }

  return createPost({
    channelId: (data as { id: string }).id,
    text: "",
    speakerCharacterId: speakerCharacterId ?? null,
    roll: { ...roll, uid: authorId, characterId: speakerCharacterId ?? null },
    gmsOnly: roll.gmsOnly,
  });
}, "Failed to post the roll to the campaign.");
