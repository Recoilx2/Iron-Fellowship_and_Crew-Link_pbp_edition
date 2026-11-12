import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewNonLinearMeterDocument } from "api-calls/homebrew/rules/nonLinearMeters/_homebrewNonLinearMeter.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewNonLinearMeterDocument>(
  "homebrew_non_linear_meters"
);

export function listenToHomebrewNonLinearMeters(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewNonLinearMeterDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
