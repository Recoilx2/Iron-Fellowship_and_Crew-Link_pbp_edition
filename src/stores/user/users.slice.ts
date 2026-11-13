import { CreateSliceType } from "stores/store.type";
import { UserSlice } from "./users.slice.type";
import { defaultUserSlice } from "./users.slice.default";
import { getProfile } from "api-calls/profiles/getProfile";

// Display names live in the profiles table (one row per person, readable by
// every signed-in person). A name that cannot be read (signed out, or the
// row is missing) resolves the entry without a doc so avatar and roster
// displays fall back to placeholders instead of spinning.

export const createUsersSlice: CreateSliceType<UserSlice> = (
  set,
  getState
) => ({
  ...defaultUserSlice,
  loadUserDocument: (userId) => {
    const existingDoc = getState().users.userMap[userId];
    if (!existingDoc) {
      set((store) => {
        store.users.userMap[userId] = { loading: true };
      });
      getProfile({ uid: userId })
        .then((profile) => {
          set((store) => {
            store.users.userMap[userId] = {
              loading: false,
              ...(profile ? { doc: { displayName: profile.displayName } } : {}),
            };
          });
        })
        .catch(() => {
          set((store) => {
            store.users.userMap[userId] = { loading: false };
          });
        });
    }
  },
  loadUserDocuments: (userIds) => {
    userIds.forEach((uid) => {
      const existingDoc = getState().users.userMap[uid];
      if (!existingDoc) {
        {
          set((store) => {
            store.users.userMap[uid] = { loading: true };
          });
          getProfile({ uid })
            .then((profile) => {
              set((store) => {
                store.users.userMap[uid] = {
                  loading: false,
                  ...(profile
                    ? { doc: { displayName: profile.displayName } }
                    : {}),
                };
              });
            })
            .catch(() => {
              set((store) => {
                store.users.userMap[uid] = { loading: false };
              });
            });
        }
      }
    });
  },
});
