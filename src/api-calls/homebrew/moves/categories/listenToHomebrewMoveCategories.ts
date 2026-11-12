import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewMoveCategoryDocument } from "api-calls/homebrew/moves/categories/_homebrewMoveCategory.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewMoveCategoryDocument>(
  "homebrew_move_categories"
);

export function listenToHomebrewMoveCategories(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewMoveCategoryDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
