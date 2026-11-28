import { useEffect } from "react";
import { useStore } from "stores/store";
import { useCurrentUserIsGm } from "hooks/useCurrentUserIsGm";

export function useListenToCurrentNPC(npcId: string) {
  const worldId = useStore((store) => store.worlds.currentWorld.currentWorldId);
  const isGM = useCurrentUserIsGm();
  const listenToCurrentNPC = useStore(
    (store) => store.worlds.currentWorld.currentWorldNPCs.subscribeToOpenNPC
  );

  useEffect(() => {
    const unsubscribe = listenToCurrentNPC(npcId);

    return () => {
      unsubscribe();
    };
  }, [worldId, isGM, listenToCurrentNPC, npcId]);
}
