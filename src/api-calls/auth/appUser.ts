import type { User } from "@supabase/supabase-js";

/**
 * App-owned signed-in person. Stores, pages and components use this instead
 * of the Supabase `User` type; the data layer converts at its edge.
 */
export interface AppUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export function toAppUser(user: User): AppUser {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    typeof metadata["display_name"] === "string"
      ? (metadata["display_name"] as string)
      : null;
  const photoURL =
    typeof metadata["avatar_url"] === "string"
      ? (metadata["avatar_url"] as string)
      : null;
  return {
    uid: user.id,
    displayName,
    email: user.email ?? null,
    photoURL,
  };
}
