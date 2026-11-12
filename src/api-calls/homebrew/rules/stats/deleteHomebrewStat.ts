import { createApiFunction } from "api-calls/createApiFunction";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";
import { HomebrewStatDocument } from "api-calls/homebrew/rules/stats/_homebrewStat.type";

const api = createHomebrewContentApi<HomebrewStatDocument>("homebrew_stats");

export const deleteHomebrewStat = createApiFunction<
  { statId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.statId, client: params.client });
}, "Failed to delete stat.");
