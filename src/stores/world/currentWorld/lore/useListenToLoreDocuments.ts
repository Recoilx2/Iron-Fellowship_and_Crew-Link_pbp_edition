import { Unsubscribe } from "api-calls/helpers.type";
import { useEffect } from "react";
import { useStore } from "stores/store";

export function useListenToLoreDocuments() {
  const worldId = useStore((store) => store.worlds.currentWorld.currentWorldId);
  const listenToLoreDocuments = useStore(
    (store) => store.worlds.currentWorld.currentWorldLore.subscribe
  );

  useEffect(() => {
    let unsubscribe: Unsubscribe;

    if (worldId) {
      unsubscribe = listenToLoreDocuments(worldId);
    }

    return () => {
      unsubscribe && unsubscribe();
    };
  }, [worldId, listenToLoreDocuments]);
}
