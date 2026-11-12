import { User } from "firebase/auth";

/**
 * App-owned signed-in user. Stores, pages and components use this instead
 * of the Firebase `User` type; the data layer converts at its edge.
 */
export interface AppUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export function toAppUser(user: User): AppUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  };
}
