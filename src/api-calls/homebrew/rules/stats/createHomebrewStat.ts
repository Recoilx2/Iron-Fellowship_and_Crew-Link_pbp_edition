import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewStatDocument } from "api-calls/homebrew/rules/stats/_homebrewStat.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewStatDocument>("homebrew_stats");

export const createHomebrewStat = createApiFunction<
  { stat: HomebrewStatDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.stat, client: params.client });
}, "Failed to create stat.");
