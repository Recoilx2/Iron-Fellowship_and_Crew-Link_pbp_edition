import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewImpact } from "api-calls/homebrew/rules/impacts/_homebrewImpacts.type";
import {
  ClientOption,
  modifyContentData,
} from "api-calls/homebrew/_supabase";

export const updateHomebrewImpact = createApiFunction<
  { impactCategoryId: string; impact: HomebrewImpact } & ClientOption,
  void
>(async (params) => {
  await modifyContentData(
    "homebrew_impact_categories",
    params.impactCategoryId,
    (data) => {
      const contents = {
        ...((data.contents ?? {}) as Record<string, unknown>),
      };
      contents[params.impact.dataswornId] = params.impact;
      data.contents = contents;
    },
    { client: params.client }
  );
}, "Failed to update impact.");
