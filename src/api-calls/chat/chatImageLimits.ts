/**
 * Selection rules for chat image attachments (spec #9, ticket #28): PNG,
 * JPEG, GIF and WebP, capped at 10 MB before the browser shrinks them. The
 * cap matches the chat-images bucket's file_size_limit in the
 * *_chat_images.sql migration, which backstops it on the server; this only
 * stops files no browser should be asked to decode.
 */

export const ACCEPTED_CHAT_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_IMAGE_LABEL = "10 MB";

/**
 * Refuses files outside the accepted types or over the pre-shrink cap, with
 * the message the composer shows; returns null when the file may attach.
 */
export function validateChatImageFile(file: File): string | null {
  if (!ACCEPTED_CHAT_IMAGE_TYPES.has(file.type)) {
    return "Images must be PNG, JPEG, GIF or WebP.";
  }
  if (file.size > MAX_CHAT_IMAGE_BYTES) {
    return `Image is too large. The maximum size is ${MAX_CHAT_IMAGE_LABEL}.`;
  }
  return null;
}
