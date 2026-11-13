import { CreateSliceType } from "stores/store.type";
import { AuthSlice, AUTH_STATE } from "./auth.slice.type";
import { defaultAuthSlice } from "./auth.slice.default";
import { listenToAuthState } from "api-calls/auth/listenToAuthState";
import { AppUser } from "api-calls/auth/appUser";
import { getProfile } from "api-calls/profiles/getProfile";
import { upsertProfile } from "api-calls/profiles/upsertProfile";
import { applyDocumentUpdate } from "api-calls/applyDocumentUpdate";
import { UserDocument } from "api-calls/user/_user.type";

// Device preferences (sidebar side, update-dialog version, dice animation
// choice) used to live in the Firebase user document. They are per-device
// UI state, so they live in local storage now: no account sync, no backend.
function userDocStorageKey(uid: string): string {
  return `iron-fellowship:userDoc:${uid}`;
}

function readStoredUserDoc(uid: string): UserDocument | undefined {
  if (typeof localStorage === "undefined" || !uid) {
    return undefined;
  }
  try {
    const raw = localStorage.getItem(userDocStorageKey(uid));
    return raw ? (JSON.parse(raw) as UserDocument) : undefined;
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

function writeStoredUserDoc(uid: string, doc: UserDocument): void {
  if (typeof localStorage === "undefined" || !uid) {
    return;
  }
  try {
    localStorage.setItem(userDocStorageKey(uid), JSON.stringify(doc));
  } catch (e) {
    console.error(e);
  }
}

export const createAuthSlice: CreateSliceType<AuthSlice> = (set, getState) => ({
  ...defaultAuthSlice,

  subscribe: () => {
    return listenToAuthState({
      onUser: (user) => {
        if (!user) {
          set((state) => {
            state.auth.user = undefined;
            state.auth.uid = "";
            state.auth.status = AUTH_STATE.UNAUTHENTICATED;
          });
          return;
        }

        // Display names live in profiles; the signup trigger normally
        // creates the row from the name typed at signup.
        getProfile({ uid: user.uid })
          .then((profile) => {
            const displayName =
              profile?.displayName || user.displayName || "";

            if (!displayName) {
              set((state) => {
                state.auth.userNameDialogOpen = true;
              });
            }

            const namedUser: AppUser = {
              ...user,
              displayName: displayName || null,
            };

            if (!profile && displayName) {
              upsertProfile({ uid: user.uid, displayName }).catch((e) => {
                console.error(e);
              });
            }

            set((state) => {
              state.auth.user = namedUser;
              state.auth.uid = namedUser.uid;
              state.auth.status = AUTH_STATE.AUTHENTICATED;
            });
          })
          .catch((e) => {
            console.error(e);
            set((state) => {
              state.auth.user = undefined;
              state.auth.uid = "";
              state.auth.status = AUTH_STATE.UNAUTHENTICATED;
            });
          });
      },
      onError: (error) => {
        console.error(error);
        set((state) => {
          state.auth.user = undefined;
          state.auth.uid = "";
          state.auth.status = AUTH_STATE.UNAUTHENTICATED;
        });
      },
    });
  },

  subscribeToUser: (uid) => {
    const stored = readStoredUserDoc(uid);
    if (stored) {
      set((state) => {
        state.auth.userDoc = stored;
      });
    }
    return () => {};
  },

  closeUserNameDialog: () => {
    set((state) => {
      state.auth.userNameDialogOpen = false;
    });
  },

  updateUserDoc: (doc) => {
    const uid = getState().auth.uid;
    const current = getState().auth.userDoc ?? { displayName: "" };
    const next = applyDocumentUpdate(
      current as unknown as Record<string, unknown>,
      doc as unknown as Record<string, unknown>
    ) as unknown as UserDocument;
    writeStoredUserDoc(uid, next);
    set((state) => {
      state.auth.userDoc = next;
    });
  },
});
