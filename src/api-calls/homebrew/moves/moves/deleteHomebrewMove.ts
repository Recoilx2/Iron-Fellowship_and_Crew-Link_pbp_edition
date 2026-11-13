import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewMoveDocument } from "api-calls/homebrew/moves/moves/_homebrewMove.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api =
  createHomebrewContentApi<HomebrewMoveDocument>("homebrew_moves");

export const deleteHomebrewMove = createApiFunction<
  { moveId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.moveId, client: params.client });
}, "Failed to delete move.");
