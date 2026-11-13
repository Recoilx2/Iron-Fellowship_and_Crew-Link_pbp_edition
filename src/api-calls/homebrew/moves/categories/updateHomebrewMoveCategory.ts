import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewMoveCategoryDocument } from "api-calls/homebrew/moves/categories/_homebrewMoveCategory.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewMoveCategoryDocument>(
  "homebrew_move_categories"
);

export const updateHomebrewMoveCategory = createApiFunction<
  {
    moveCategoryId: string;
    moveCategory: DocumentUpdate<HomebrewMoveCategoryDocument>;
  } & ClientOption,
  void
>(async (params) => {
  await api.update({
    id: params.moveCategoryId,
    doc: params.moveCategory,
    client: params.client,
  });
}, "Failed to update move category.");
