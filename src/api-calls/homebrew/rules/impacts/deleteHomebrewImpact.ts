import { createApiFunction } from "api-calls/createApiFunction";
import {
  ClientOption,
  modifyContentData,
} from "api-calls/homebrew/_supabase";

export const deleteHomebrewImpact = createApiFunction<
  { impactCategoryId: string; impactId: string } & ClientOption,
  void
>(async (params) => {
  await modifyContentData(
    "homebrew_impact_categories",
    params.impactCategoryId,
    (data) => {
      const contents = {
        ...((data.contents ?? {}) as Record<string, unknown>),
      };
      delete contents[params.impactId];
      data.contents = contents;
    },
    { client: params.client }
  );
}, "Failed to delete impact.");
