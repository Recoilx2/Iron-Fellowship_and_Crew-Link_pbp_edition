import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CHAT_POSTS_TABLE } from "./_postRef";

/**
 * Posts formatted text to a channel as the speaker the interface chose: one
 * of the author's characters in the campaign, one of the campaign world's
 * NPCs (GMs alone), or nobody for posting as self (players out of
 * character, GMs everywhere). Image attachments ride along as chat-images
 * storage paths, uploaded when attached (#28); a post needs text, images,
 * or both. Members post into open channels only; the post access rules
 * refuse outsiders, foreign speakers and archived channels, and the caller
 * sees the failure.
 */
export const createPost = createApiFunction<
  {
    channelId: string;
    text: string;
    speakerCharacterId?: string | null;
    speakerNpcId?: string | null;
    imagePaths?: string[];
    postId?: string;
  },
  string
>(async (params) => {
  const { channelId, text, speakerCharacterId, speakerNpcId, imagePaths, postId } = params;
  if (!channelId) {
    throw new Error("A channel is required to post.");
  }
  const trimmed = text.trim();
  const paths = imagePaths ?? [];
  if (trimmed.length === 0 && paths.length === 0) {
    throw new Error("Post text or images are required.");
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
    text: trimmed,
    image_paths: paths,
  });
  if (error) {
    throw error;
  }
  return id;
}, "Failed to send post.");
