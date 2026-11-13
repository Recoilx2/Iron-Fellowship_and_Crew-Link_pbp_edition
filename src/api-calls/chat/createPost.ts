import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import type { Roll } from "types/DieRolls.type";
import { CHAT_POSTS_TABLE, postDocumentToColumns } from "./_postRef";

/**
 * Posts formatted text to a channel as the speaker the interface chose: one
 * of the author's characters in the campaign, or nobody for posting as
 * self (players out of character, GMs everywhere). A roll from the composer
 * travels with the post in the app's existing roll shape and stands in for
 * the words, so a roll-only post carries empty text. Members post into open
 * channels only; the post access rules refuse outsiders, foreign speakers,
 * archived channels and non-GM GM-only posts, and the caller sees the
 * failure.
 */
export const createPost = createApiFunction<
  {
    channelId: string;
    text: string;
    speakerCharacterId?: string | null;
    roll?: Roll | null;
    gmsOnly?: boolean;
  },
  string
>(async (params) => {
  const { channelId, text, speakerCharacterId, roll, gmsOnly } = params;
  if (!channelId) {
    throw new Error("A channel is required to post.");
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 && !roll) {
    throw new Error("Post text is required.");
  }
  const { data: sessionData, error: sessionError } =
    await getSupabaseClient().auth.getSession();
  const authorId = sessionData.session?.user.id;
  if (sessionError || !authorId) {
    throw sessionError ?? new Error("You must be logged in to post.");
  }
  // The id is generated here so the insert needs no RETURNING clause,
  // matching the channel convention: later post rules (private channels)
  // re-query their own table and would fail insert-then-select RLS.
  const id = crypto.randomUUID();
  const { error } = await getSupabaseClient().from(CHAT_POSTS_TABLE).insert({
    id,
    channel_id: channelId,
    author_id: authorId,
    speaker_character_id: speakerCharacterId ?? null,
    ...postDocumentToColumns({ text: trimmed, roll, gmsOnly }),
  });
  if (error) {
    throw error;
  }
  return id;
}, "Failed to send post.");
