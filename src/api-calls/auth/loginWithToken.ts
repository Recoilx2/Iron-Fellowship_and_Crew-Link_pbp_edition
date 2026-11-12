import { signInWithCustomToken } from "firebase/auth";
import { firebaseAuth } from "config/firebase.config";

export function loginWithToken(token: string) {
  return new Promise((resolve, reject) => {
    signInWithCustomToken(firebaseAuth, token)
      .then(() => {
        resolve(true);
      })
      .catch((e) => {
        console.error(e);
        reject(e);
      });
  });
}
