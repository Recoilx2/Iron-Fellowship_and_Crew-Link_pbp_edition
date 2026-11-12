import { Unsubscribe } from "api-calls/helpers.type";
import { useEffect } from "react";
import { useStore } from "stores/store";

export function useListenToOracleSettings() {
  const uid = useStore((store) => store.auth.user?.uid);
  const subscribe = useStore(
    (store) => store.settings.subscribeToPinnedOracleSettings
  );

  useEffect(() => {
    let unsubscribe: Unsubscribe;
    if (uid) {
      unsubscribe = subscribe(uid);
    }
    return () => {
      unsubscribe && unsubscribe();
    };
  }, [uid, subscribe]);
}
