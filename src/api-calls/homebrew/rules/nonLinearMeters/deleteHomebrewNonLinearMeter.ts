import { createApiFunction } from "api-calls/createApiFunction";
import { HomebrewNonLinearMeterDocument } from "api-calls/homebrew/rules/nonLinearMeters/_homebrewNonLinearMeter.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewNonLinearMeterDocument>(
  "homebrew_non_linear_meters"
);

export const deleteHomebrewNonLinearMeter = createApiFunction<
  { meterId: string } & ClientOption,
  void
>(async (params) => {
  await api.remove({ id: params.meterId, client: params.client });
}, "Failed to delete non-linear meter.");
