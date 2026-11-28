import { useEffect } from "react";
import { useStore } from "stores/store";
import { useCurrentUserIsGm } from "hooks/useCurrentUserIsGm";

export function useListenToCurrentLoreDocument(loreId: string) {
  const worldId = useStore((store) => store.worlds.currentWorld.currentWorldId);
  const isGM = useCurrentUserIsGm();
  const listenToCurrentLoreDocument = useStore(
    (store) => store.worlds.currentWorld.currentWorldLore.subscribeToOpenLore
  );

  useEffect(() => {
    const unsubscribe = listenToCurrentLoreDocument(loreId);

    return () => {
      unsubscribe();
    };
  }, [worldId, isGM, listenToCurrentLoreDocument, loreId]);
}
