import { useEffect } from "react";
import { useStore } from "stores/store";
import { useCurrentUserIsGm } from "hooks/useCurrentUserIsGm";

export function useListenToCurrentLocation(locationId: string) {
  const worldId = useStore((store) => store.worlds.currentWorld.currentWorldId);
  const isGM = useCurrentUserIsGm();
  const listenToCurrentLocation = useStore(
    (store) =>
      store.worlds.currentWorld.currentWorldLocations.subscribeToOpenLocation
  );

  const loadMapBackgroundImage = useStore(
    (store) =>
      store.worlds.currentWorld.currentWorldLocations
        .updateMapBackgroundImageUrl
  );
  const currentLocationImageBackgroundFilename = useStore(
    (store) =>
      store.worlds.currentWorld.currentWorldLocations.locationMap[locationId]
        ?.mapBackgroundImageFilename
  );

  useEffect(() => {
    const unsubscribe = listenToCurrentLocation(locationId);

    return () => {
      unsubscribe();
    };
  }, [worldId, isGM, listenToCurrentLocation, locationId]);

  useEffect(() => {
    loadMapBackgroundImage(locationId, currentLocationImageBackgroundFilename);
  }, [
    currentLocationImageBackgroundFilename,
    locationId,
    loadMapBackgroundImage,
  ]);
}
