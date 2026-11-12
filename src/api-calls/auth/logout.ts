import { signOut } from "firebase/auth";
import { firebaseAuth } from "config/firebase.config";

export async function logout() {
  await signOut(firebaseAuth);
}
