import { CreateSliceType } from "stores/store.type";
import { LocationTab, LocationsSlice } from "./locations.slice.type";
import { defaultLocationsSlice } from "./locations.slice.default";
import { listenToLocations } from "api-calls/world/locations/listenToLocations";
import { createLocation } from "api-calls/world/locations/createLocation";
import { deleteLocation } from "api-calls/world/locations/deleteLocation";
import { updateLocation } from "api-calls/world/locations/updateLocation";
import { updateLocationGMNotes } from "api-calls/world/locations/updateLocationGMNotes";
import { updateLocationGMProperties } from "api-calls/world/locations/updateLocationGMProperties";
import { updateLocationNotes } from "api-calls/world/locations/updateLocationNotes";
import { uploadLocationImage } from "api-calls/world/locations/uploadLocationImage";
import { listenToLocationNotes } from "api-calls/world/locations/listenToLocationNotes";
import { addLocationToMapCell } from "api-calls/world/locations/addLocationToMapCell";
import { removeLocationFromMapCell } from "api-calls/world/locations/removeLocationFromMapCell";
import { listenToLocationGMNotes } from "api-calls/world/locations/listenToLocationGMNotes";
import { listenToLocationGMProperties } from "api-calls/world/locations/listenToLocationGMProperties";
import { updateLocationCharacterBond } from "api-calls/world/locations/updateLocationCharacterBond";
import { removeLocationImage } from "api-calls/world/locations/removeLocationImage";
import { createSpecificLocation } from "api-calls/world/locations/createSpecificLocation";
import { MapEntry, MapEntryType } from "types/Locations.type";
import { uploadLocationMapBackgroundImage } from "api-calls/world/locations/uploadLocationMapBackgroundImage";
import { removeLocationMapBackgroundImage } from "api-calls/world/locations/removeLocationMapBackgroundImage";
import { getWorldImageUrl } from "api-calls/world/worldImageStorage";
import {
  ensureWorldItemNotes,
  getWorldItemNoteIds,
} from "api-calls/world/worldNotes";
import type { GMLocation } from "types/Locations.type";

/**
 * Merges streamed GM notes bytes into the structured GM details, keeping
 * each side's updates. No details and no notes means no GM properties.
 */
function withGMNotes(
  details: GMLocation | null | undefined,
  notes: Uint8Array | undefined
): GMLocation | null {
  const { gmNotes: _dropped, ...rest } = details ?? {};
  void _dropped;
  if (notes) {
    return { ...rest, gmNotes: notes };
  }
  return Object.keys(rest).length > 0 ? rest : null;
}

export const createLocationsSlice: CreateSliceType<LocationsSlice> = (
  set,
  getState
) => ({
  ...defaultLocationsSlice,
  subscribe: (currentWorldId: string) => {
    return listenToLocations(
      currentWorldId,
      (locationId, location) => {
        set((store) => {
          if (
            Array.isArray(location.imageFilenames) &&
            location.imageFilenames?.length > 0
          ) {
            store.worlds.currentWorld.doAnyDocsHaveImages = true;
          }
          const existingLocation =
            store.worlds.currentWorld.currentWorldLocations.locationMap[
              locationId
            ];
          const gmProperties = existingLocation?.gmProperties;
          const notes = existingLocation?.notes;
          const publicNoteId = existingLocation?.publicNoteId;
          const gmNoteId = existingLocation?.gmNoteId;
          const imageUrl =
            (location.imageFilenames?.length ?? 0) > 0
              ? existingLocation?.imageUrl
              : undefined;
          const mapBackgroundImageUrl = location.mapBackgroundImageFilename
            ? existingLocation?.mapBackgroundImageUrl
            : undefined;
          store.worlds.currentWorld.currentWorldLocations.locationMap[
            locationId
          ] = {
            ...location,
            gmProperties,
            notes,
            publicNoteId,
            gmNoteId,
            imageUrl,
            mapBackgroundImageUrl,
          };
        });
      },
      (locationId, imageUrl) => {
        set((store) => {
          store.worlds.currentWorld.currentWorldLocations.locationMap[
            locationId
          ].imageUrl = imageUrl;
        });
      },
      (locationId) => {
        set((store) => {
          delete store.worlds.currentWorld.currentWorldLocations.locationMap[
            locationId
          ];
        });
      },
      (error) => {
        set((store) => {
          store.worlds.currentWorld.currentWorldLocations.error =
            error instanceof Error ? error.message : String(error);
        });
      }
    );
  },
  setOpenLocationId: (locationId) => {
    set((store) => {
      store.worlds.currentWorld.currentWorldLocations.openLocationId =
        locationId;
      store.worlds.currentWorld.currentWorldLocations.openTab =
        LocationTab.Notes;
    });
  },
  closeLocation: () => {
    set((store) => {
      const currentLocationId =
        store.worlds.currentWorld.currentWorldLocations.openLocationId;
      if (currentLocationId) {
        const parentLocationId =
          store.worlds.currentWorld.currentWorldLocations.locationMap[
            currentLocationId
          ]?.parentLocationId;
        store.worlds.currentWorld.currentWorldLocations.openLocationId =
          parentLocationId ?? undefined;
      } else {
        store.worlds.currentWorld.currentWorldLocations.openLocationId =
          undefined;
      }
    });
  },
  setLocationTab: (tab) => {
    set((store) => {
      store.worlds.currentWorld.currentWorldLocations.openTab = tab;
    });
  },
  setLocationSearch: (search) => {
    set((store) => {
      store.worlds.currentWorld.currentWorldLocations.locationSearch = search;
    });
  },

  createLocation: () => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return createLocation({ worldId });
  },
  createSpecificLocation: (location) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return createSpecificLocation({ worldId, location });
  },
  deleteLocation: (locationId) => {
    const currentWorld = getState().worlds.currentWorld;
    const worldId = currentWorld.currentWorldId;
    const imageFilename =
      currentWorld.currentWorldLocations.locationMap[locationId]
        ?.imageFilenames?.[0];
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return deleteLocation({ worldId, locationId, imageFilename });
  },
  moveLocation: (locationId, location, parentId, row, col) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    const updateLocation =
      getState().worlds.currentWorld.currentWorldLocations.updateLocation;
    const placeLocationOnMap =
      getState().worlds.currentWorld.currentWorldLocations.placeLocationOnMap;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    // Remove the previous location from the map
    const oldParentId = location.parentLocationId;
    if (oldParentId) {
      const parentLocation =
        getState().worlds.currentWorld.currentWorldLocations.locationMap[
          oldParentId
        ];
      if (parentLocation) {
        const parentMap = parentLocation.map as Record<
          string,
          Record<string, MapEntry>
        >;
        if (parentMap) {
          Object.keys(parentMap ?? {}).forEach((row) => {
            Object.keys(parentMap[row]).forEach((col) => {
              const entry = parentMap[row][col];
              if (
                entry?.type === MapEntryType.Location &&
                entry.locationIds.includes(locationId)
              ) {
                removeLocationFromMapCell({
                  worldId,
                  mapLocationId: oldParentId,
                  row: Number(row),
                  col: Number(col),
                  locationId,
                }).catch(() => {});
              }
            });
          });
        }
      }
    }
    // Update the location with the new parent
    updateLocation(locationId, {
      parentLocationId: parentId ?? null,
    }).catch(() => {});

    if (typeof row === "number" && typeof col === "number" && parentId) {
      // Add the new location to the map
      return placeLocationOnMap(parentId, row, col, locationId);
    } else {
      return Promise.resolve();
    }
  },
  updateLocation: (locationId, partialLocation) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateLocation({ worldId, locationId, location: partialLocation });
  },
  placeLocationOnMap: (mapLocationId, row, col, locationId) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return addLocationToMapCell({
      worldId,
      mapLocationId,
      row,
      col,
      locationId,
    });
  },
  updateLocationGMNotes: (locationId, notes, isBeacon) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateLocationGMNotes({ worldId, locationId, notes, isBeacon });
  },
  updateLocationGMProperties: (locationId, locationGMProperties) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateLocationGMProperties({
      worldId,
      locationId,
      locationGMProperties,
    });
  },
  updateLocationNotes: (locationId, notes, isBeacon) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateLocationNotes({ worldId, locationId, notes, isBeacon });
  },
  updateLocationCharacterBond: (locationId, characterId, bonded) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateLocationCharacterBond({
      worldId,
      locationId,
      characterId,
      bonded,
    });
  },
  uploadLocationImage: (locationId, image) => {
    const world = getState().worlds.currentWorld;
    const worldId = world.currentWorldId;
    const imageFilename =
      world.currentWorldLocations.locationMap[locationId]?.imageFilenames?.[0];
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }

    return uploadLocationImage({
      worldId,
      locationId,
      image,
      oldImageFilename: imageFilename,
    });
  },
  uploadLocationMapBackground: (locationId, image) => {
    const world = getState().worlds.currentWorld;
    const worldId = world.currentWorldId;
    const imageFilename =
      world.currentWorldLocations.locationMap[locationId]
        ?.mapBackgroundImageFilename;

    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }

    return uploadLocationMapBackgroundImage({
      worldId,
      locationId,
      image,
      oldImageFilename: imageFilename,
    });
  },
  updateMapBackgroundImageUrl: (locationId, filename) => {
    const worldId = getState().worlds.currentWorld.currentWorldId ?? "";

    if (!worldId) {
      return;
    } else if (!filename) {
      set(
        (store) =>
          (store.worlds.currentWorld.currentWorldLocations.locationMap[
            locationId
          ].mapBackgroundImageUrl = undefined)
      );
      return;
    }
    getWorldImageUrl(worldId, locationId, filename)
      .then((url) => {
        set((store) => {
          store.worlds.currentWorld.currentWorldLocations.locationMap[
            locationId
          ].mapBackgroundImageUrl = url;
        });
      })
      .catch(() => {});
  },
  removeLocationImage: (locationId) => {
    const world = getState().worlds.currentWorld;
    const worldId = world.currentWorldId;
    const filename =
      world.currentWorldLocations.locationMap[locationId]?.imageFilenames?.[0];

    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    if (!filename) {
      return new Promise((res, reject) =>
        reject("Location did not have an image")
      );
    }
    return removeLocationImage({
      worldId,
      locationId,
      filename,
    });
  },
  removeLocationMapBackground: (locationId) => {
    const world = getState().worlds.currentWorld;
    const worldId = world.currentWorldId;
    const filename =
      world.currentWorldLocations.locationMap[locationId]
        ?.mapBackgroundImageFilename;

    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    if (!filename) {
      return new Promise((res, reject) =>
        reject("Location did not have an image")
      );
    }
    return removeLocationMapBackgroundImage({
      worldId,
      locationId,
      filename,
    });
  },
  subscribeToOpenLocation: (locationId) => {
    const state = getState();
    const worldId = state.worlds.currentWorld.currentWorldId;

    if (!worldId) {
      return () => {};
    }

    // The open item's note ids back the live editors. Notes are created
    // with the item; when they are missing (a slower create racing the
    // open), a world GM backfills them while everyone else keeps waiting
    // for the live rows below.
    getWorldItemNoteIds("location", locationId)
      .then((ids) => {
        if (ids.publicNoteId && ids.gmNoteId) {
          return ids;
        }
        return ensureWorldItemNotes(worldId, "location", locationId).catch(
          () => ids
        );
      })
      .then((ids) => {
        set((store) => {
          const entry =
            store.worlds.currentWorld.currentWorldLocations.locationMap[
              locationId
            ];
          if (entry) {
            entry.publicNoteId = ids.publicNoteId;
            entry.gmNoteId = ids.gmNoteId;
          }
        });
      })
      .catch(() => {});

    const notesUnsubscribe = listenToLocationNotes(
      worldId,
      locationId,
      (notes) => {
        set((store) => {
          if (
            store.worlds.currentWorld.currentWorldLocations.locationMap[
              locationId
            ]
          ) {
            store.worlds.currentWorld.currentWorldLocations.locationMap[
              locationId
            ].notes = notes ?? null;
          }
        });
      },
      (error) => {
        console.error(error);
      }
    );

    // GM rows are always subscribed: the database filters them, so players
    // simply receive nothing and the location keeps null GM properties.
    const gmPropertiesUnsubscribe = listenToLocationGMProperties(
      worldId,
      locationId,
      (properties) => {
        set((store) => {
          const entry =
            store.worlds.currentWorld.currentWorldLocations.locationMap[
              locationId
            ];
          if (entry) {
            const gmNotes = entry.gmProperties?.gmNotes;
            entry.gmProperties = withGMNotes(properties ?? undefined, gmNotes);
          }
        });
      },
      (error) => {
        console.error(error);
      }
    );

    const gmNotesUnsubscribe = listenToLocationGMNotes(
      worldId,
      locationId,
      (notes) => {
        set((store) => {
          const entry =
            store.worlds.currentWorld.currentWorldLocations.locationMap[
              locationId
            ];
          if (entry) {
            entry.gmProperties = withGMNotes(entry.gmProperties, notes);
          }
        });
      },
      (error) => {
        console.error(error);
      }
    );

    return () => {
      notesUnsubscribe();
      gmPropertiesUnsubscribe();
      gmNotesUnsubscribe();
    };
  },
  resetStore: () => {
    set((store) => {
      store.worlds.currentWorld.currentWorldLocations = {
        ...store.worlds.currentWorld.currentWorldLocations,
        ...defaultLocationsSlice,
      };
    });
  },
});
