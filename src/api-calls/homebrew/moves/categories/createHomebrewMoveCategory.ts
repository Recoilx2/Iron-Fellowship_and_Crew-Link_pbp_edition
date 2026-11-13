import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewMoveCategoryDocument } from "api-calls/homebrew/moves/categories/_homebrewMoveCategory.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewMoveCategoryDocument>(
  "homebrew_move_categories"
);

export const createHomebrewMoveCategory = createApiFunction<
  { moveCategory: HomebrewMoveCategoryDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.moveCategory, client: params.client });
}, "Failed to create move category.");
