import { createApiFunction } from "api-calls/createApiFunction";
import {
  ClientOption,
  resolveClient,
} from "api-calls/homebrew/_supabase";

export const removeHomebrewViewer = createApiFunction<
  { id: string; uid: string } & ClientOption,
  void
>(async (params) => {
  const { data, error } = await resolveClient({ client: params.client }).rpc(
    "homebrew_remove_viewer",
    {
      p_collection_id: params.id,
      p_user_id: params.uid,
    }
  );
  if (error) throw error;
  if (data !== true) {
    throw new Error("Failed to remove viewer.");
  }
}, "Failed to remove viewer.");
