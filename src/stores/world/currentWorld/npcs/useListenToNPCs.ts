import { Unsubscribe } from "api-calls/helpers.type";
import { useEffect } from "react";
import { useStore } from "stores/store";

export function useListenToNPCs() {
  const worldId = useStore((store) => store.worlds.currentWorld.currentWorldId);
  const listenToNPCs = useStore(
    (store) => store.worlds.currentWorld.currentWorldNPCs.subscribe
  );

  useEffect(() => {
    let unsubscribe: Unsubscribe;

    if (worldId) {
      unsubscribe = listenToNPCs(worldId);
    }

    return () => {
      unsubscribe && unsubscribe();
    };
  }, [worldId, listenToNPCs]);
}
