/**
 * Object-URL lifecycle for image bytes fetched with the viewer's own token
 * (ticket #152): the bytes live in a blob for as long as the app shows
 * them. A replaced or discarded URL must be revoked, or the bytes stay
 * held for the whole session.
 */

/** Revokes `previous` when it differs from `next`; returns `next`. */
export function replaceObjectUrl(
  previous: string | undefined,
  next: string
): string {
  if (previous && previous !== next) {
    URL.revokeObjectURL(previous);
  }
  return next;
}

/** Revokes a URL the app no longer holds. */
export function dropObjectUrl(url: string | undefined): void {
  if (url) {
    URL.revokeObjectURL(url);
  }
}
