import { sendSignInLinkToEmail } from "firebase/auth";
import { firebaseAuth } from "config/firebase.config";
import { BASE_ROUTES, basePaths } from "routes";

export function sendMagicEmailLink(
  email: string,
  name?: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    // The backup magic link flow lives under /auth, since /login now serves
    // the primary one-time code flow. Landing a magic link on /login would
    // drop the user on the code form mid sign-in.
    const actionCodeSettings = {
      url: window.location.origin + basePaths[BASE_ROUTES.AUTH] + "/login",
      handleCodeInApp: true,
    };

    sendSignInLinkToEmail(firebaseAuth, email, actionCodeSettings)
      .then(() => {
        window.localStorage.setItem("auth-email", email);
        if (name) {
          window.localStorage.setItem("auth-name", name);
        }
        resolve(true);
      })
      .catch((error) => {
        console.error(error);
        reject(error);
      });
  });
}
