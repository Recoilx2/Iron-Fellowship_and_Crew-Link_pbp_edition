import { CreateSliceType } from "stores/store.type";
import { LoreSlice } from "./lore.slice.type";
import { defaultLoreSlice } from "./lore.slice.default";
import { listenToLoreDocuments } from "api-calls/world/lore/listenToLoreDocuments";
import { createLore } from "api-calls/world/lore/createLore";
import { deleteLore } from "api-calls/world/lore/deleteLore";
import { updateLore } from "api-calls/world/lore/updateLore";
import { updateLoreGMNotes } from "api-calls/world/lore/updateLoreGMNotes";
import { updateLoreGMProperties } from "api-calls/world/lore/updateLoreGMProperties";
import { updateLoreNotes } from "api-calls/world/lore/updateLoreNotes";
import { uploadLoreImage } from "api-calls/world/lore/uploadLoreImage";
import { listenToLoreNotes } from "api-calls/world/lore/listenToLoreNotes";
import { listenToLoreGMProperties } from "api-calls/world/lore/listenToLoreGMProperties";
import { removeLoreImage } from "api-calls/world/lore/removeLoreImage";
import {
  ensureWorldItemNotes,
  getWorldItemNoteIds,
} from "api-calls/world/worldNotes";

export const createLoreSlice: CreateSliceType<LoreSlice> = (set, getState) => ({
  ...defaultLoreSlice,
  subscribe: (currentWorldId: string) => {
    return listenToLoreDocuments(
      currentWorldId,
      (loreId, lore) => {
        set((store) => {
          if (
            Array.isArray(lore.imageFilenames) &&
            lore.imageFilenames?.length > 0
          ) {
            store.worlds.currentWorld.doAnyDocsHaveImages = true;
          }
          const existingLore =
            store.worlds.currentWorld.currentWorldLore.loreMap[loreId];
          const gmProperties = existingLore?.gmProperties;
          const notes = existingLore?.notes;
          const publicNoteId = existingLore?.publicNoteId;
          const gmNoteId = existingLore?.gmNoteId;
          const imageUrl =
            (lore.imageFilenames?.length ?? 0) > 0
              ? existingLore?.imageUrl
              : undefined;
          store.worlds.currentWorld.currentWorldLore.loreMap[loreId] = {
            ...lore,
            gmProperties,
            notes,
            publicNoteId,
            gmNoteId,
            imageUrl,
          };
        });
      },
      (loreId, imageUrl) => {
        set((store) => {
          store.worlds.currentWorld.currentWorldLore.loreMap[loreId].imageUrl =
            imageUrl;
        });
      },
      (loreId) => {
        set((store) => {
          delete store.worlds.currentWorld.currentWorldLore.loreMap[loreId];
        });
      },
      (error) => {
        set((store) => {
          store.worlds.currentWorld.currentWorldLore.error =
            error instanceof Error ? error.message : String(error);
        });
      }
    );
  },
  setOpenLoreId: (loreId) => {
    set((store) => {
      store.worlds.currentWorld.currentWorldLore.openLoreId = loreId;
    });
  },
  setLoreSearch: (search) => {
    set((store) => {
      store.worlds.currentWorld.currentWorldLore.loreSearch = search;
    });
  },

  createLore: () => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return createLore({ worldId });
  },
  deleteLore: (loreId) => {
    const world = getState().worlds.currentWorld;
    const worldId = world.currentWorldId;
    const imageFilename =
      world.currentWorldLore.loreMap[loreId]?.imageFilenames?.[0];

    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return deleteLore({ worldId, loreId, imageFilename });
  },
  updateLore: (loreId, partialLore) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateLore({ worldId, loreId, lore: partialLore });
  },
  updateLoreGMNotes: (loreId, notes, isBeacon) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateLoreGMNotes({ worldId, loreId, notes, isBeacon });
  },
  updateLoreGMProperties: (loreId, loreGMProperties) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateLoreGMProperties({
      worldId,
      loreId,
      loreGMProperties,
    });
  },
  updateLoreNotes: (loreId, notes, isBeacon) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateLoreNotes({ worldId, loreId, notes, isBeacon });
  },
  uploadLoreImage: (loreId, image) => {
    const world = getState().worlds.currentWorld;
    const worldId = world.currentWorldId;
    const imageFilename =
      world.currentWorldLore.loreMap[loreId]?.imageFilenames?.[0];

    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return uploadLoreImage({
      worldId,
      loreId,
      image,
      oldImageFilename: imageFilename,
    });
  },
  removeLoreImage: (loreId) => {
    const world = getState().worlds.currentWorld;
    const worldId = world.currentWorldId;
    const filename =
      world.currentWorldLore.loreMap[loreId]?.imageFilenames?.[0];

    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    if (!filename) {
      return new Promise((res, reject) => reject("Lore did not have an image"));
    }
    return removeLoreImage({
      worldId,
      loreId,
      filename,
    });
  },
  subscribeToOpenLore: (loreId) => {
    const state = getState();
    const worldId = state.worlds.currentWorld.currentWorldId;

    if (!worldId) {
      return () => {};
    }

    // The open lore's note ids back the live editors. Notes are created
    // with the lore; when they are missing (a slower create racing the
    // open), a world GM backfills them while everyone else keeps waiting
    // for the live rows below.
    getWorldItemNoteIds("lore", loreId)
      .then((ids) => {
        if (ids.publicNoteId && ids.gmNoteId) {
          return ids;
        }
        return ensureWorldItemNotes(worldId, "lore", loreId).catch(() => ids);
      })
      .then((ids) => {
        set((store) => {
          const entry =
            store.worlds.currentWorld.currentWorldLore.loreMap[loreId];
          if (entry) {
            entry.publicNoteId = ids.publicNoteId;
            entry.gmNoteId = ids.gmNoteId;
          }
        });
      })
      .catch(() => {});

    const notesUnsubscribe = listenToLoreNotes(
      worldId,
      loreId,
      (notes) => {
        set((store) => {
          if (store.worlds.currentWorld.currentWorldLore.loreMap[loreId]) {
            store.worlds.currentWorld.currentWorldLore.loreMap[loreId].notes =
              notes ?? null;
          }
        });
      },
      (error) => {
        console.error(error);
      }
    );

    // GM rows are always subscribed: the database filters them, so players
    // simply receive nothing and the lore keeps null GM properties.
    const gmPropertiesUnsubscribe = listenToLoreGMProperties(
      worldId,
      loreId,
      (properties) => {
        set((store) => {
          if (store.worlds.currentWorld.currentWorldLore.loreMap[loreId]) {
            store.worlds.currentWorld.currentWorldLore.loreMap[
              loreId
            ].gmProperties = properties ?? null;
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
    };
  },
  resetStore: () => {
    set((store) => {
      store.worlds.currentWorld.currentWorldLore = {
        ...store.worlds.currentWorld.currentWorldLore,
        ...defaultLoreSlice,
      };
    });
  },
});
