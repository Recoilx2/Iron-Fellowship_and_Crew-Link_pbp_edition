import { getSupabaseClient } from "config/supabase.config";

/**
 * Sends a magic-link sign-in email through the deployment's SMTP server
 * (see supabase/.env.example). The link returns to this site, where the
 * session is picked up automatically; like all single-use links it must be
 * opened in the same browser that requested it. When `name` is given (signup)
 * it is stored in the auth user's metadata so the profile row created on
 * signup already carries the display name.
 */
export function sendMagicEmailLink(params: {
  email: string;
  name?: string;
}): Promise<boolean> {
  const { email, name } = params;
  return getSupabaseClient()
    .auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
        data: name ? { display_name: name } : {},
      },
    })
    .then(({ error }) => {
      if (error) {
        console.error(error);
        return Promise.reject("Failed to send sign-in email.");
      }
      return true;
    });
}
