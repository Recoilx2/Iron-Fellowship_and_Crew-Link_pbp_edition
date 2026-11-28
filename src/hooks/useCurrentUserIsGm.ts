import { useStore } from "stores/store";

const EMPTY_IDS: string[] = [];

/**
 * Reactive form of currentUserIsGm: re-renders when the campaign roster
 * loads or changes, so a GM whose gmIds arrive after the campaignId still
 * re-subscribes with the GM topic binding.
 */
export function useCurrentUserIsGm(): boolean {
  const uid = useStore((store) => store.auth?.uid ?? "");
  const gmIds = useStore(
    (store) => store.campaigns?.currentCampaign?.currentCampaign?.gmIds ?? EMPTY_IDS
  );
  return gmIds.includes(uid);
}
