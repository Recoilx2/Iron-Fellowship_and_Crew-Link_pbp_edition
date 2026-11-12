import { arrayRemove, Timestamp, updateDoc } from "firebase/firestore";
import { getLocationDoc } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const removeLocationFromMapCell = createApiFunction<
  {
    worldId: string;
    mapLocationId: string;
    row: number;
    col: number;
    locationId: string;
  },
  void
>((params) => {
  const { worldId, mapLocationId, row, col, locationId } = params;

  return new Promise((resolve, reject) => {
    updateDoc(getLocationDoc(worldId, mapLocationId), {
      updatedTimestamp: Timestamp.now(),
      [`map.${row}.${col}.locationIds`]: arrayRemove(locationId),
    })
      .then(() => {
        resolve();
      })
      .catch((e) => {
        reject(e);
      });
  });
}, "Failed to update location.");
