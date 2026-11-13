import { useEffect } from "react";
import { useStore } from "stores/store";

export function useListenToCurrentLoreDocument(loreId: string) {
  const worldId = useStore((store) => store.worlds.currentWorld.currentWorldId);
  const listenToCurrentLoreDocument = useStore(
    (store) => store.worlds.currentWorld.currentWorldLore.subscribeToOpenLore
  );

  useEffect(() => {
    const unsubscribe = listenToCurrentLoreDocument(loreId);

    return () => {
      unsubscribe();
    };
  }, [worldId, listenToCurrentLoreDocument, loreId]);
}
