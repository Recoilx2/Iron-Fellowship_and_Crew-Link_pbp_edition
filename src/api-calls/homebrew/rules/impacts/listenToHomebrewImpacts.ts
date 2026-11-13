import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewImpactCategoryDocument } from "api-calls/homebrew/rules/impacts/_homebrewImpacts.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewImpactCategoryDocument>(
  "homebrew_impact_categories"
);

export function listenToHomebrewImpacts(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewImpactCategoryDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
