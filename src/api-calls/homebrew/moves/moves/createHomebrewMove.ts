import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewMoveDocument } from "api-calls/homebrew/moves/moves/_homebrewMove.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api =
  createHomebrewContentApi<HomebrewMoveDocument>("homebrew_moves");

export const createHomebrewMove = createApiFunction<
  { move: HomebrewMoveDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.move, client: params.client });
}, "Failed to create move.");
