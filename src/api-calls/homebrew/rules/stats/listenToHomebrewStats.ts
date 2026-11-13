import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewStatDocument } from "api-calls/homebrew/rules/stats/_homebrewStat.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api = createHomebrewContentApi<HomebrewStatDocument>("homebrew_stats");

export function listenToHomebrewStats(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewStatDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
