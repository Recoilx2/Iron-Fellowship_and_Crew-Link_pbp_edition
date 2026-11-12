import { Unsubscribe } from "api-calls/helpers.type";
import { useEffect } from "react";
import { useStore } from "stores/store";

export function useListenToAuth() {
  const subscribe = useStore((store) => store.auth.subscribe);
  const uid = useStore((store) => store.auth.user?.uid);
  const listenToUserDoc = useStore((store) => store.auth.subscribeToUser);

  useEffect(() => {
    const unsubscribe = subscribe();

    return () => {
      unsubscribe();
    };
  }, [subscribe]);

  useEffect(() => {
    let unsubscribe: Unsubscribe;

    if (uid) {
      unsubscribe = listenToUserDoc(uid);
    }
    return () => {
      unsubscribe && unsubscribe();
    };
  }, [uid, listenToUserDoc]);
}
