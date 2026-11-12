import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewConditionMeterDocument } from "api-calls/homebrew/rules/conditionMeters/_homebrewConditionMeters.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewConditionMeterDocument>(
  "homebrew_condition_meters"
);

export function listenToHomebrewConditionMeters(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewConditionMeterDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
