import { CreateSliceType } from "stores/store.type";
import { AuthSlice, AUTH_STATE } from "./auth.slice.type";
import { defaultAuthSlice } from "./auth.slice.default";
import { listenToAuthState } from "api-calls/auth/listenToAuthState";
import { AppUser } from "api-calls/auth/appUser";
import { getProfile } from "api-calls/profiles/getProfile";
import { upsertProfile } from "api-calls/profiles/upsertProfile";
import { UserDocument } from "api-calls/user/_user.type";
import { updateUserDoc } from "api-calls/user/updateUserDoc";
import { listenToUserDoc } from "api-calls/user/listenToUserDoc";
import { updateUserDocNestedFields } from "api-calls/user/updateUserDocNestedFields";

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

            // Legacy copy for the Firestore-backed name displays, until the
            // data-area tickets read names from profiles instead.
            const userDoc: UserDocument = {
              displayName: displayName || "Unknown User",
            };

            updateUserDoc({ uid: user.uid, user: userDoc }).catch((e) => {
              console.error(e);
            });

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
    return listenToUserDoc(uid, (user) => {
      set((state) => {
        state.auth.userDoc = user;
      });
    });
  },

  closeUserNameDialog: () => {
    set((state) => {
      state.auth.userNameDialogOpen = false;
    });
  },

  updateUserDoc: (doc) => {
    const uid = getState().auth.uid;

    updateUserDocNestedFields({ uid, user: doc }).catch(() => {});
  },
});
