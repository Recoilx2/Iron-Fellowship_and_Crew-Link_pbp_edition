import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewStatDocument } from "api-calls/homebrew/rules/stats/_homebrewStat.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewStatDocument>("homebrew_stats");

export const updateHomebrewStat = createApiFunction<
  { statId: string; stat: DocumentUpdate<HomebrewStatDocument> } & ClientOption,
  void
>(async (params) => {
  await api.update({ id: params.statId, doc: params.stat, client: params.client });
}, "Failed to update stat.");
