import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewMoveDocument } from "api-calls/homebrew/moves/moves/_homebrewMove.type";
import {
  ClientOption,
  createHomebrewContentApi,
} from "api-calls/homebrew/_supabase";

const api =
  createHomebrewContentApi<HomebrewMoveDocument>("homebrew_moves");

export function listenToHomebrewMoves(
  homebrewId: string,
  updateData: (data: Record<string, HomebrewMoveDocument>) => void,
  onError: (error: unknown) => void,
  opts?: ClientOption
): Unsubscribe {
  return api.listen(homebrewId, updateData, onError, opts);
}
