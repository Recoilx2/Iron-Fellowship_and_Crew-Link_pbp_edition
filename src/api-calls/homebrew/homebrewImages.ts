import { createApiFunction } from "api-calls/createApiFunction";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_LABEL } from "api-calls/storage/imageLimits";
import {
  ClientOption,
  resolveClient,
} from "api-calls/homebrew/_supabase";

const HOMEBREW_IMAGES_BUCKET = "homebrew-images";

/**
 * Homebrew images live in a guarded storage bucket: anyone reads them, only
 * signed-in people upload or delete. The bucket is created idempotently
 * before the first upload, since the storage service boots after the
 * database migrations run.
 */
export const uploadHomebrewImage = createApiFunction<
  { collectionId: string; file: File } & ClientOption,
  string
>(async (params) => {
  const { collectionId, file } = params;
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`Image must be smaller than ${MAX_FILE_SIZE_LABEL} in size.`);
  }
  const client = resolveClient({ client: params.client });
  const { error: bucketError } = await client.rpc(
    "homebrew_ensure_image_bucket"
  );
  if (bucketError) throw bucketError;
  const path = `${collectionId}/${file.name}`;
  const { error } = await client.storage
    .from(HOMEBREW_IMAGES_BUCKET)
    .upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}, "Failed to upload homebrew image.");

export async function getHomebrewImageUrl(
  path: string,
  opts?: ClientOption
): Promise<string> {
  const client = resolveClient(opts);
  const { data } = client.storage.from(HOMEBREW_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export const deleteHomebrewImage = createApiFunction<
  { path: string } & ClientOption,
  void
>(async (params) => {
  const client = resolveClient({ client: params.client });
  const { error } = await client.storage
    .from(HOMEBREW_IMAGES_BUCKET)
    .remove([params.path]);
  if (error) throw error;
}, "Failed to delete homebrew image.");
