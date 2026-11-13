import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewNonLinearMeterDocument } from "api-calls/homebrew/rules/nonLinearMeters/_homebrewNonLinearMeter.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewNonLinearMeterDocument>(
  "homebrew_non_linear_meters"
);

export const createHomebrewNonLinearMeter = createApiFunction<
  { meter: HomebrewNonLinearMeterDocument } & ClientOption,
  void
>(async (params) => {
  await api.create({ doc: params.meter, client: params.client });
}, "Failed to create non-linear meter.");
