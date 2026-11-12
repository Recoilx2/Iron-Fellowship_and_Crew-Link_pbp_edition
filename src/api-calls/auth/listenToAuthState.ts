import { onAuthStateChanged } from "firebase/auth";
import { firebaseAuth } from "config/firebase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { AppUser, toAppUser } from "./appUser";

/**
 * Data-layer auth-state listener. Converts the backend user to the
 * app-owned `AppUser` at the edge and returns a plain unsubscribe function.
 */
export function listenToAuthState(params: {
  onUser: (user: AppUser | null) => void;
  onError?: (error: unknown) => void;
}): Unsubscribe {
  return onAuthStateChanged(
    firebaseAuth,
    (user) => params.onUser(user ? toAppUser(user) : null),
    (error) => params.onError?.(error)
  );
}
