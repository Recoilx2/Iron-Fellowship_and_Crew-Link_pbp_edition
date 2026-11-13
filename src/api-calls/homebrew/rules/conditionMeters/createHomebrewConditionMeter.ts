import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewConditionMeterDocument } from "api-calls/homebrew/rules/conditionMeters/_homebrewConditionMeters.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewConditionMeterDocument>(
  "homebrew_condition_meters"
);

export const createHomebrewConditionMeter = createApiFunction<
  { conditionMeter: HomebrewConditionMeterDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.conditionMeter, client: params.client });
}, "Failed to create condition meter.");
