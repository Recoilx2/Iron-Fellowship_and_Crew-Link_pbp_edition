import type { IStore } from "stores/store.type";

/**
 * Whether the signed-in user is a GM of the open campaign. Read
 * synchronously so listeners can skip best-effort GM topic joins before
 * they open a socket; the same roster is used by the chat and roll-log
 * listeners.
 */
export function currentUserIsGm(state: IStore): boolean {
  return (
    state.campaigns?.currentCampaign?.currentCampaign?.gmIds?.includes(
      state.auth?.uid ?? ""
    ) ?? false
  );
}
