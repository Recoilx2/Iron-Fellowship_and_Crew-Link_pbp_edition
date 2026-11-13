import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewMoveCategoryDocument } from "api-calls/homebrew/moves/categories/_homebrewMoveCategory.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewMoveCategoryDocument>(
  "homebrew_move_categories"
);

export const deleteHomebrewMoveCategory = createApiFunction<
  { moveCategoryId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.moveCategoryId, client: params.client });
}, "Failed to delete move category.");
