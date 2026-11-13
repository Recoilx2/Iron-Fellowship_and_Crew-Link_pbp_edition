/**
 * Selection rules for chat image attachments (spec #9, tickets #28 and
 * #118): PNG, JPEG, GIF and WebP, capped before the browser shrinks them.
 * The cap comes from the VITE_CHAT_IMAGE_MAX_MB deployment setting
 * (default 10 MB) -- the same setting the chat-images bucket reads for its
 * file_size_limit (see supabase/.env.example and the
 * *_chat_image_access.sql migration) -- so the browser and the server
 * refuse the same files. The bucket backstops the cap and the allowed
 * types on the server; this only stops files no browser should be asked
 * to decode.
 */

export const ACCEPTED_CHAT_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const DEFAULT_CHAT_IMAGE_MAX_MB = 10;

/**
 * The deployment's per-image cap in megabytes: a positive integer, or the
 * default when the setting is missing or broken.
 */
function configuredMaxMb(): number {
  const raw = import.meta.env.VITE_CHAT_IMAGE_MAX_MB as string | undefined;
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CHAT_IMAGE_MAX_MB;
}

export const MAX_CHAT_IMAGE_MB = configuredMaxMb();
export const MAX_CHAT_IMAGE_BYTES = MAX_CHAT_IMAGE_MB * 1024 * 1024;
export const MAX_CHAT_IMAGE_LABEL = `${MAX_CHAT_IMAGE_MB} MB`;

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
