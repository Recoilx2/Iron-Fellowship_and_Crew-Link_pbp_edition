import {
  isSignInWithEmailLink,
  signInWithEmailLink,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth } from "config/firebase.config";
import { getErrorMessage } from "functions/getErrorMessage";

export function completeMagicLinkSignupIfPresent(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (isSignInWithEmailLink(firebaseAuth, window.location.href)) {
      // Additional state parameters can also be passed via URL.
      // This can be used to continue the user's intended action before triggering
      // the sign-in operation.
      // Get the email if available. This should be available if the user completes
      // the flow on the same device where they started it.
      let email = window.localStorage.getItem("auth-email");
      if (!email) {
        // User opened the link on a different device. To prevent session fixation
        // attacks, ask the user to provide the associated email again. For example:
        email = window.prompt("Please provide your email for confirmation");
      }
      if (email) {
        // The client SDK will parse the code from the link for you.
        signInWithEmailLink(firebaseAuth, email, window.location.href)
          .then((result) => {
            // Clear email from storage.
            window.localStorage.removeItem("auth-email");
            const name = window.localStorage.getItem("auth-name");
            if (name) {
              updateProfile(result.user, { displayName: name });
            }
            window.localStorage.removeItem("auth-name");
            resolve(true);
          })
          .catch((error) => {
            console.error(error);
            reject(
              getErrorMessage(
                error,
                "Error signing in from email link. Please try again."
              )
            );
          });
      } else {
        reject("Failed to get your email for sign in.");
      }
    } else {
      resolve(true);
    }
  });
}
