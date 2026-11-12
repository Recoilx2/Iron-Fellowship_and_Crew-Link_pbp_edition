import { createApiFunction } from "api-calls/createApiFunction";
import { DocumentUpdate } from "api-calls/helpers.type";
import { HomebrewNonLinearMeterDocument } from "api-calls/homebrew/rules/nonLinearMeters/_homebrewNonLinearMeter.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewNonLinearMeterDocument>(
  "homebrew_non_linear_meters"
);

export const updateHomebrewNonLinearMeter = createApiFunction<
  {
    meterId: string;
    meter: DocumentUpdate<HomebrewNonLinearMeterDocument>;
  } & ClientOption,
  void
>(async (params) => {
  await api.update({
    id: params.meterId,
    doc: params.meter,
    client: params.client,
  });
}, "Failed to update non-linear meter.");
