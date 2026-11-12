import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewConditionMeterDocument } from "api-calls/homebrew/rules/conditionMeters/_homebrewConditionMeters.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewConditionMeterDocument>(
  "homebrew_condition_meters"
);

export const updateHomebrewConditionMeter = createApiFunction<
  {
    conditionMeterId: string;
    conditionMeter: DocumentUpdate<HomebrewConditionMeterDocument>;
  } & ClientOption,
  void
>(async (params) => {
  await api.update({
    id: params.conditionMeterId,
    doc: params.conditionMeter,
    client: params.client,
  });
}, "Failed to update condition meter.");
