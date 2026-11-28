import { Unsubscribe } from "api-calls/helpers.type";
import { useEffect } from "react";
import { useStore } from "stores/store";
import { useCurrentUserIsGm } from "hooks/useCurrentUserIsGm";

export function useListenToLocations() {
  const worldId = useStore((store) => store.worlds.currentWorld.currentWorldId);
  const isGM = useCurrentUserIsGm();
  const listenToLocations = useStore(
    (store) => store.worlds.currentWorld.currentWorldLocations.subscribe
  );

  useEffect(() => {
    let unsubscribe: Unsubscribe;

    if (worldId) {
      unsubscribe = listenToLocations(worldId);
    }

    return () => {
      unsubscribe && unsubscribe();
    };
  }, [worldId, isGM, listenToLocations]);
}
