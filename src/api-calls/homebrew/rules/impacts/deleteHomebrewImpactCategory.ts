import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewImpactCategoryDocument } from "api-calls/homebrew/rules/impacts/_homebrewImpacts.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewImpactCategoryDocument>(
  "homebrew_impact_categories"
);

export const deleteHomebrewImpactCategory = createApiFunction<
  { impactCategoryId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.impactCategoryId, client: params.client });
}, "Failed to delete impact category.");
