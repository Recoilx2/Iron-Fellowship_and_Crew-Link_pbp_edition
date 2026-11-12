import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewConditionMeterDocument } from "api-calls/homebrew/rules/conditionMeters/_homebrewConditionMeters.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewConditionMeterDocument>(
  "homebrew_condition_meters"
);

export const deleteHomebrewConditionMeter = createApiFunction<
  { conditionMeterId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.conditionMeterId, client: params.client });
}, "Failed to delete condition meter.");
