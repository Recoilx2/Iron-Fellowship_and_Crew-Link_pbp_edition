import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewImpactCategoryDocument } from "api-calls/homebrew/rules/impacts/_homebrewImpacts.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewImpactCategoryDocument>(
  "homebrew_impact_categories"
);

export const updateHomebrewImpactCategory = createApiFunction<
  {
    impactCategoryId: string;
    impactCategory: DocumentUpdate<HomebrewImpactCategoryDocument>;
  } & ClientOption,
  void
>(async (params) => {
  await api.update({
    id: params.impactCategoryId,
    doc: params.impactCategory,
    client: params.client,
  });
}, "Failed to update impact category.");
