import { onAuthStateChanged } from "firebase/auth";
import { firebaseAuth } from "config/firebase.config";
import { AppUser, toAppUser } from "./appUser";

export function getUser(): Promise<AppUser | null> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (user) => {
        unsubscribe();
        resolve(user ? toAppUser(user) : null);
      },
      (error) => {
        console.error(error);
        unsubscribe();
        resolve(null);
      }
    );
  });
}
