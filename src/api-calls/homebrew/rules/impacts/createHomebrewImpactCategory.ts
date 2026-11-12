import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewImpactCategoryDocument } from "api-calls/homebrew/rules/impacts/_homebrewImpacts.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewImpactCategoryDocument>(
  "homebrew_impact_categories"
);

export const createHomebrewImpactCategory = createApiFunction<
  { impactCategory: HomebrewImpactCategoryDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.impactCategory, client: params.client });
}, "Failed to create impact category.");
