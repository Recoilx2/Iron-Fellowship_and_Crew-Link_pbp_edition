import { updateProfile } from "firebase/auth";
import { firebaseAuth } from "config/firebase.config";
import { updateUserDoc } from "api-calls/user/updateUserDoc";
import { UserDocument } from "api-calls/user/_user.type";

export function updateUser(userDoc: UserDocument): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      reject(new Error("User is not logged in."));
      return;
    }
    updateProfile(user, { displayName: userDoc.displayName })
      .then(() => {
        updateUserDoc({
          uid: user.uid,
          user: userDoc,
        })
          .then(() => {
            resolve();
          })
          .catch((e) => {
            console.error(e);
            reject("Failed to update user.");
          });
      })
      .catch((e) => {
        console.error(e);
        reject("Failed to update user name.");
      });
  });
}
