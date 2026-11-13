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
 * access rules on the bucket let only the campaign's members read and
 * write; outsiders load nothing. Large images are shrunk in the browser
 * before upload, except GIFs, which go up untouched so animations survive.
 */

export const CHAT_IMAGES_BUCKET = "chat-images";

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

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
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw error ?? new Error("Failed to load chat image.");
  }
  return data.signedUrl;
}
