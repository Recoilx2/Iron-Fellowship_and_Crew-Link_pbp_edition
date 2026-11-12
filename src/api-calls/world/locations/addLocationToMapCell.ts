import { arrayUnion, Timestamp, updateDoc } from "firebase/firestore";
import { getLocationDoc } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";
import { MapEntryType } from "types/Locations.type";

export const addLocationToMapCell = createApiFunction<
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
      [`map.${row}.${col}.type`]: MapEntryType.Location,
      [`map.${row}.${col}.locationIds`]: arrayUnion(locationId),
    })
      .then(() => {
        resolve();
      })
      .catch((e) => {
        reject(e);
      });
  });
}, "Failed to update location.");
