import { CreateSliceType } from "stores/store.type";
import { NPCsSlice } from "./npcs.slice.type";
import { defaultNPCsSlice } from "./npcs.slice.default";
import { listenToNPCs } from "api-calls/world/npcs/listenToNPCs";
import { createNPC } from "api-calls/world/npcs/createNPC";
import { deleteNPC } from "api-calls/world/npcs/deleteNPC";
import { updateNPC } from "api-calls/world/npcs/updateNPC";
import { updateNPCGMNotes } from "api-calls/world/npcs/updateNPCGMNotes";
import { updateNPCGMProperties } from "api-calls/world/npcs/updateNPCGMProperties";
import { updateNPCNotes } from "api-calls/world/npcs/updateNPCNotes";
import { uploadNPCImage } from "api-calls/world/npcs/uploadNPCImage";
import { listenToNPCNotes } from "api-calls/world/npcs/listenToNPCNotes";
import { listenToNPCGMNotes } from "api-calls/world/npcs/listenToNPCGMNotes";
import { listenToNPCGMProperties } from "api-calls/world/npcs/listenToNPCGMProperties";
import { updateNPCCharacterBond } from "api-calls/world/npcs/updateNPCCharacterBond";
import { updateNPCCharacterConnection } from "api-calls/world/npcs/updateNPCCharacterConnection";
import { updateNPCCharacterBondProgress } from "api-calls/world/npcs/updateNPCCharacterBondProgress";
import { removeNPCImage } from "api-calls/world/npcs/removeNPCImage";
import {
  ensureWorldItemNotes,
  getWorldItemNoteIds,
} from "api-calls/world/worldNotes";
import type { GMNPC } from "types/NPCs.type";

/**
 * Merges streamed GM notes bytes into the structured GM details, keeping
 * each side's updates. No details and no notes means no GM properties.
 */
function withGMNotes(
  details: GMNPC | null | undefined,
  notes: Uint8Array | undefined
): GMNPC | null {
  const { gmNotes: _dropped, ...rest } = details ?? {};
  void _dropped;
  if (notes) {
    return { ...rest, gmNotes: notes };
  }
  return Object.keys(rest).length > 0 ? rest : null;
}

export const createNPCsSlice: CreateSliceType<NPCsSlice> = (set, getState) => ({
  ...defaultNPCsSlice,
  subscribe: (currentWorldId: string) => {
    return listenToNPCs(
      currentWorldId,
      (npcId, npc) => {
        set((store) => {
          if (
            Array.isArray(npc.imageFilenames) &&
            npc.imageFilenames?.length > 0
          ) {
            store.worlds.currentWorld.doAnyDocsHaveImages = true;
          }
          const existingNPC =
            store.worlds.currentWorld.currentWorldNPCs.npcMap[npcId];
          const gmProperties = existingNPC?.gmProperties;
          const notes = existingNPC?.notes;
          const publicNoteId = existingNPC?.publicNoteId;
          const gmNoteId = existingNPC?.gmNoteId;
          const imageUrl =
            (npc.imageFilenames?.length ?? 0) > 0
              ? existingNPC?.imageUrl
              : undefined;
          store.worlds.currentWorld.currentWorldNPCs.npcMap[npcId] = {
            ...npc,
            gmProperties,
            notes,
            publicNoteId,
            gmNoteId,
            imageUrl,
          };
        });
      },
      (npcId, imageUrl) => {
        set((store) => {
          if (store.worlds.currentWorld.currentWorldNPCs.npcMap[npcId]) {
            store.worlds.currentWorld.currentWorldNPCs.npcMap[npcId].imageUrl =
              imageUrl;
          }
        });
      },
      (npcId) => {
        set((store) => {
          delete store.worlds.currentWorld.currentWorldNPCs.npcMap[npcId];
        });
      },
      (error) => {
        set((store) => {
          store.worlds.currentWorld.currentWorldNPCs.error =
            error instanceof Error ? error.message : String(error);
        });
      }
    );
  },
  setOpenNPCId: (npcId) => {
    set((store) => {
      store.worlds.currentWorld.currentWorldNPCs.openNPCId = npcId;
    });
  },
  setNPCSearch: (search) => {
    set((store) => {
      store.worlds.currentWorld.currentWorldNPCs.npcSearch = search;
    });
  },

  createNPC: (npc) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return createNPC({ worldId, npc });
  },
  deleteNPC: (npcId) => {
    const currentWorld = getState().worlds.currentWorld;
    const worldId = currentWorld.currentWorldId;
    const npcImageFilename =
      currentWorld.currentWorldNPCs.npcMap[npcId]?.imageFilenames?.[0];

    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return deleteNPC({ worldId, npcId, imageFilename: npcImageFilename });
  },
  updateNPC: (npcId, partialNPC) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateNPC({ worldId, npcId, npc: partialNPC });
  },
  updateNPCGMNotes: (npcId, notes, isBeacon) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateNPCGMNotes({ worldId, npcId, notes, isBeacon });
  },
  updateNPCGMProperties: (npcId, npcGMProperties) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateNPCGMProperties({
      worldId,
      npcId,
      npcGMProperties,
    });
  },
  updateNPCNotes: (npcId, notes, isBeacon) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateNPCNotes({ worldId, npcId, notes, isBeacon });
  },
  updateNPCCharacterBond: (npcId, characterId, bonded) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateNPCCharacterBond({
      worldId,
      npcId,
      characterId,
      bonded,
    });
  },
  updateNPCCharacterConnection: (npcId, characterId, isConnection) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateNPCCharacterConnection({
      worldId,
      npcId,
      characterId,
      isConnection,
    });
  },

  updateNPCCharacterBondValue: (npcId, characterId, progress) => {
    const worldId = getState().worlds.currentWorld.currentWorldId;
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return updateNPCCharacterBondProgress({
      worldId,
      npcId,
      characterId,
      progress,
    });
  },
  uploadNPCImage: (npcId, image) => {
    const currentWorld = getState().worlds.currentWorld;
    const worldId = currentWorld.currentWorldId;
    const oldNPCImageFilename =
      currentWorld.currentWorldNPCs.npcMap[npcId]?.imageFilenames?.[0];
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    return uploadNPCImage({
      worldId,
      npcId,
      image,
      oldImageFilename: oldNPCImageFilename,
    });
  },
  removeNPCImage: (npcId) => {
    const currentWorld = getState().worlds.currentWorld;
    const worldId = currentWorld.currentWorldId;
    const filename =
      currentWorld.currentWorldNPCs.npcMap[npcId]?.imageFilenames?.[0];
    if (!worldId) {
      return new Promise((res, reject) => reject("No world found"));
    }
    if (!filename) {
      return new Promise((res, reject) => reject("No image found to remove"));
    }
    return removeNPCImage({
      worldId,
      npcId,
      filename,
    });
  },
  subscribeToOpenNPC: (npcId) => {
    const state = getState();
    const worldId = state.worlds.currentWorld.currentWorldId;

    if (!worldId) {
      return () => {};
    }

    // The open NPC's note ids back the live editors. Notes are created
    // with the NPC; when they are missing (a slower create racing the
    // open), a world GM backfills them while everyone else keeps waiting
    // for the live rows below.
    getWorldItemNoteIds("npc", npcId)
      .then((ids) => {
        if (ids.publicNoteId && ids.gmNoteId) {
          return ids;
        }
        return ensureWorldItemNotes(worldId, "npc", npcId).catch(() => ids);
      })
      .then((ids) => {
        set((store) => {
          const entry = store.worlds.currentWorld.currentWorldNPCs.npcMap[npcId];
          if (entry) {
            entry.publicNoteId = ids.publicNoteId;
            entry.gmNoteId = ids.gmNoteId;
          }
        });
      })
      .catch(() => {});

    const notesUnsubscribe = listenToNPCNotes(
      worldId,
      npcId,
      (notes) => {
        set((store) => {
          if (store.worlds.currentWorld.currentWorldNPCs.npcMap[npcId]) {
            store.worlds.currentWorld.currentWorldNPCs.npcMap[npcId].notes =
              notes ?? null;
          }
        });
      },
      (error) => {
        console.error(error);
      }
    );

    // GM rows are always subscribed: the database filters them, so players
    // simply receive nothing and the NPC keeps null GM properties.
    const gmPropertiesUnsubscribe = listenToNPCGMProperties(
      worldId,
      npcId,
      (properties) => {
        set((store) => {
          const entry =
            store.worlds.currentWorld.currentWorldNPCs.npcMap[npcId];
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

    const gmNotesUnsubscribe = listenToNPCGMNotes(
      worldId,
      npcId,
      (notes) => {
        set((store) => {
          const entry =
            store.worlds.currentWorld.currentWorldNPCs.npcMap[npcId];
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
      store.worlds.currentWorld.currentWorldNPCs = {
        ...store.worlds.currentWorld.currentWorldNPCs,
        ...defaultNPCsSlice,
      };
    });
  },
});
