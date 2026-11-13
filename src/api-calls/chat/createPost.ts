import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import type { Roll } from "types/DieRolls.type";
import { CHAT_POSTS_TABLE, postDocumentToColumns } from "./_postRef";

/**
 * Posts formatted text to a channel as the speaker the interface chose: one
 * of the author's characters in the campaign, one of the campaign world's
 * NPCs (GMs alone), or nobody for posting as self (players out of
 * character, GMs everywhere). A roll from the composer travels with the
 * post in the app's existing roll shape and stands in for the words, so a
 * roll-only post carries empty text. Image attachments ride along as
 * chat-images storage paths, uploaded when attached (#28); a post needs
 * text, images, or a roll. Members post into open channels only; the post
 * access rules refuse outsiders, foreign speakers, archived channels and
 * non-GM GM-only posts, and the caller sees the failure.
 */
export const createPost = createApiFunction<
  {
    channelId: string;
    text: string;
    speakerCharacterId?: string | null;
    speakerNpcId?: string | null;
    imagePaths?: string[];
    postId?: string;
    roll?: Roll | null;
    gmsOnly?: boolean;
  },
  string
>(async (params) => {
  const {
    channelId,
    text,
    speakerCharacterId,
    speakerNpcId,
    imagePaths,
    postId,
    roll,
    gmsOnly,
  } = params;
  if (!channelId) {
    throw new Error("A channel is required to post.");
  }
  const trimmed = text.trim();
  const paths = imagePaths ?? [];
  if (trimmed.length === 0 && paths.length === 0 && !roll) {
    throw new Error("Post text, images, or a roll are required.");
  }
  const { data: sessionData, error: sessionError } =
    await getSupabaseClient().auth.getSession();
  const authorId = sessionData.session?.user.id;
  if (sessionError || !authorId) {
    throw sessionError ?? new Error("You must be logged in to post.");
  }
  // The id is generated here so the insert needs no RETURNING clause,
  // matching the channel convention: later post rules (private channels)
  // re-query their own table and would fail insert-then-select RLS. The
  // composer passes its own id so attachments uploaded while composing
  // land under the post they belong to.
  const id = postId ?? crypto.randomUUID();
  const { error } = await getSupabaseClient().from(CHAT_POSTS_TABLE).insert({
    id,
    channel_id: channelId,
    author_id: authorId,
    speaker_character_id: speakerCharacterId ?? null,
    speaker_npc_id: speakerNpcId ?? null,
    ...postDocumentToColumns({ text: trimmed, imagePaths: paths, roll, gmsOnly }),
  });
  if (error) {
    throw error;
  }
  return id;
}, "Failed to send post.");
