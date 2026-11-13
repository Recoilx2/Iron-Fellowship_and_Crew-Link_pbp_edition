import { getSupabaseClient } from "config/supabase.config";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_LABEL } from "api-calls/storage/imageLimits";
import { shrinkImageFile } from "api-calls/storage/shrinkImage";

/**
 * Portrait files in the private `portraits` bucket, one folder per owner:
 * portraits/<ownerId>/<characterId>/<filename>. Access rules on the bucket
 * let only the owner write; the owner and the character's campaign members
 * may read. Large images are shrunk in the browser before upload.
 */

export const PORTRAITS_BUCKET = "portraits";

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

// Selection cap for the portrait pickers. Large images are shrunk in the
// browser before upload (see shrinkImage.ts); this only stops files no
// browser should be asked to decode.
export const MAX_PORTRAIT_SELECTION_BYTES = 10 * 1024 * 1024;
export const MAX_PORTRAIT_SELECTION_LABEL = "10 MB";

export function portraitFilePath(
  uid: string,
  characterId: string,
  filename: string
): string {
  return `${uid}/${characterId}/${filename}`;
}

export async function uploadPortraitFile(
  uid: string,
  characterId: string,
  image: File
): Promise<string> {
  const shrunk = await shrinkImageFile(image);
  if (shrunk.size > MAX_FILE_SIZE) {
    throw new Error(
      `Image must be smaller than ${MAX_FILE_SIZE_LABEL} in size.`
    );
  }
  const path = portraitFilePath(uid, characterId, shrunk.name);
  const { error } = await getSupabaseClient()
    .storage.from(PORTRAITS_BUCKET)
    .upload(path, shrunk, { upsert: true, contentType: shrunk.type });
  if (error) {
    throw error;
  }
  return shrunk.name;
}

export async function getPortraitUrl(
  uid: string,
  characterId: string,
  filename: string
): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage.from(PORTRAITS_BUCKET)
    .createSignedUrl(portraitFilePath(uid, characterId, filename), SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw error ?? new Error("Failed to load character portrait.");
  }
  return data.signedUrl;
}

export async function removePortraitFile(
  uid: string,
  characterId: string,
  filename: string
): Promise<void> {
  const { error } = await getSupabaseClient()
    .storage.from(PORTRAITS_BUCKET)
    .remove([portraitFilePath(uid, characterId, filename)]);
  if (error) {
    throw error;
  }
}
