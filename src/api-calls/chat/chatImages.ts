import { getSupabaseClient } from "config/supabase.config";
import {
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_LABEL,
  validateChatImageFile,
} from "api-calls/chat/chatImageLimits";
import { shrinkImageFile } from "api-calls/storage/shrinkImage";

/**
 * Attachment files in the private `chat-images` bucket, one folder per
 * campaign and post: chat-images/<campaignId>/<postId>/<filename>. The
 * access rules on the bucket let an image read exactly when its post reads
 * (channel members through the visibility check, GMs alone for GM-only
 * roll posts); files waiting for a post read only for their uploader.
 * Uploads land only in a not-yet-posted folder or the uploader's own
 * post, and nobody overwrites a sent file: pending uploads may be
 * retried, but a posted image's bytes are final. Outsiders load nothing.
 * Large images are shrunk in the browser before upload, except GIFs,
 * which go up untouched so animations survive.
 */

export const CHAT_IMAGES_BUCKET = "chat-images";

/**
 * Signed links stay short-lived (minutes): a revoked member's links stop
 * working quickly. The feed re-signs an image when it shows it again
 * (see ChatPostImages), so short links never interrupt reading.
 */
export const CHAT_IMAGE_SIGNED_URL_TTL_SECONDS = 10 * 60;

export function chatImageFilePath(
  campaignId: string,
  postId: string,
  filename: string
): string {
  return `${campaignId}/${postId}/${filename}`;
}

export async function uploadChatImage(
  campaignId: string,
  postId: string,
  image: File
): Promise<string> {
  const refusal = validateChatImageFile(image);
  if (refusal) {
    throw new Error(refusal);
  }
  // GIFs skip shrinking: redrawing them would flatten their animation, and
  // the selection cap above already bounds what the browser must hold.
  const shrunk =
    image.type === "image/gif" ? image : await shrinkImageFile(image);
  if (shrunk.size > MAX_CHAT_IMAGE_BYTES) {
    throw new Error(
      `Image is too large. The maximum size is ${MAX_CHAT_IMAGE_LABEL}.`
    );
  }
  const path = chatImageFilePath(campaignId, postId, shrunk.name);
  const { error } = await getSupabaseClient()
    .storage.from(CHAT_IMAGES_BUCKET)
    .upload(path, shrunk, { upsert: true, contentType: shrunk.type });
  if (error) {
    throw error;
  }
  return path;
}

export async function removeChatImage(path: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .storage.from(CHAT_IMAGES_BUCKET)
    .remove([path]);
  if (error) {
    throw error;
  }
}

export async function getChatImageUrl(path: string): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage.from(CHAT_IMAGES_BUCKET)
    .createSignedUrl(path, CHAT_IMAGE_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw error ?? new Error("Failed to load chat image.");
  }
  return data.signedUrl;
}
