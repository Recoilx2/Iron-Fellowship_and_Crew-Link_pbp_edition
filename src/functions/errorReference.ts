/**
 * Short reference codes for user-facing failures (story 38): the user sees
 * only the generic message plus this code, while details stay in logs. Chat
 * surfaces failures in two places -- API toasts and inline composer alerts
 * -- so both mint the same shape of code from here instead of each
 * formatting its own.
 */
export function mintErrorReference(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "0");
}

/**
 * References already logged for a thrown error, so the surface that shows
 * the failure (a panel, an inline alert) can show the same code the log
 * line carries. A WeakMap keeps the error object itself untouched, so the
 * original rejection still reaches every caller exactly as thrown.
 */
const loggedReferences = new WeakMap<object, string>();

/**
 * The reference to log and show for a failure: the one already logged for
 * this error, else the server's `ref` when the error carries one, else a
 * newly minted one. The choice is remembered for object errors so the log
 * line, the toast and any panel agree.
 */
export function referenceForLogging(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const known = loggedReferences.get(error);
    if (known) return known;
    const serverRef = (error as { ref?: unknown }).ref;
    const chosen =
      typeof serverRef === "string" && serverRef ? serverRef : mintErrorReference();
    loggedReferences.set(error, chosen);
    return chosen;
  }
  return mintErrorReference();
}

/** The reference already logged for this error, if any. */
export function loggedReferenceOf(error: unknown): string | null {
  return typeof error === "object" && error !== null
    ? (loggedReferences.get(error) ?? null)
    : null;
}
