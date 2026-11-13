import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewMoveDocument } from "api-calls/homebrew/moves/moves/_homebrewMove.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api =
  createHomebrewContentApi<HomebrewMoveDocument>("homebrew_moves");

export const updateHomebrewMove = createApiFunction<
  { moveId: string; move: DocumentUpdate<HomebrewMoveDocument> } & ClientOption,
  void
>(async (params) => {
  await api.update({ id: params.moveId, doc: params.move, client: params.client });
}, "Failed to update move.");
