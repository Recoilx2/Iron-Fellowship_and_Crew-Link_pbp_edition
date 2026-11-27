import { getSupabaseClient } from "config/supabase.config";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_LABEL } from "api-calls/storage/imageLimits";
import { shrinkImageFile } from "api-calls/storage/shrinkImage";

/**
 * Image files in the private `world-images` bucket, one folder per world
 * item: world-images/<worldId>/<itemId>/<filename>. The bucket's access
 * rules let only the world's GMs write; the world's viewers may read.
 * Large images are shrunk in the browser before upload.
 */

export const WORLD_IMAGES_BUCKET = "world-images";

// Selection cap for the world image pickers. Large images are shrunk in the
// browser before upload (see shrinkImage.ts); this only stops files no
// browser should be asked to decode.
export const MAX_WORLD_IMAGE_SELECTION_BYTES = 10 * 1024 * 1024;
export const MAX_WORLD_IMAGE_SELECTION_LABEL = "10 MB";

export function worldImageFilePath(
  worldId: string,
  itemId: string,
  filename: string
): string {
  return `${worldId}/${itemId}/${filename}`;
}

export async function uploadWorldImageFile(
  worldId: string,
  itemId: string,
  image: File
): Promise<string> {
  const shrunk = await shrinkImageFile(image);
  if (shrunk.size > MAX_FILE_SIZE) {
    throw new Error(
      `Image must be smaller than ${MAX_FILE_SIZE_LABEL} in size.`
    );
  }
  const path = worldImageFilePath(worldId, itemId, shrunk.name);
  const { error } = await getSupabaseClient()
    .storage.from(WORLD_IMAGES_BUCKET)
    .upload(path, shrunk, { upsert: true, contentType: shrunk.type });
  if (error) {
    throw error;
  }
  return shrunk.name;
}

/**
 * Loads the image's bytes with the viewer's own token (RS256;
 * ticket #152) and returns an object URL for it. Storage's signed-URL flow
 * is gone: its tokens were HMAC-signed, and the stack's verifier refuses
 * HMAC. The object URL holds the bytes until revoked — the caller owns
 * that (the world stores revoke when they replace a URL).
 */
export async function getWorldImageUrl(
  worldId: string,
  itemId: string,
  filename: string
): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage.from(WORLD_IMAGES_BUCKET)
    .download(worldImageFilePath(worldId, itemId, filename));
  if (error || !data) {
    throw error ?? new Error("Failed to load world image.");
  }
  return URL.createObjectURL(data);
}

export async function removeWorldImageFile(
  worldId: string,
  itemId: string,
  filename: string
): Promise<void> {
  const { error } = await getSupabaseClient()
    .storage.from(WORLD_IMAGES_BUCKET)
    .remove([worldImageFilePath(worldId, itemId, filename)]);
  if (error) {
    throw error;
  }
}
