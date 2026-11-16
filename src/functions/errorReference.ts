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
 * Remembers the reference a thrown error carries (the server's `ref`, or one
 * the client minted and logged), so every surface shows the same code.
 * Only the client's own error class calls this; a stray `ref` property on
 * any other object is never taken for a reference.
 */
export function rememberReference(error: object, ref: string): void {
  loggedReferences.set(error, ref);
}

/**
 * The reference to log and show for a failure: the one remembered for this
 * error, else a newly minted one, remembered for object errors so the log
 * line, the toast and any panel agree. A reused error object keeps its
 * first reference.
 */
export function referenceForLogging(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const known = loggedReferences.get(error);
    if (known) return known;
    const minted = mintErrorReference();
    loggedReferences.set(error, minted);
    return minted;
  }
  return mintErrorReference();
}

const MAX_LOGGED_STRING = 500;

/**
 * Error-like means an `Error`, or a plain object with a string `message`
 * plus a `code` or `details` (the shape of a PostgrestError that is not an
 * Error subclass). Detail objects callers pass on purpose, such as
 * `{fileSize, fileType}` or `{path, status, body}`, have no `message`, so
 * they are never taken for errors.
 */
function isErrorLike(value: unknown): value is Record<string, unknown> {
  if (value instanceof Error) return true;
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === "string" &&
    ("code" in candidate || "details" in candidate)
  );
}

function capped(value: string): string {
  return value.length > MAX_LOGGED_STRING
    ? `${value.slice(0, MAX_LOGGED_STRING)}...`
    : value;
}

/**
 * The only parts of an error that are logged: name, code, status and
 * message. `details` (a PostgrestError's "Failing row contains (...)" can
 * hold post text), `hint`, `stack`, `cause` and any other field are dropped.
 */
function summariseError(error: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of ["name", "code", "status", "message"] as const) {
    const value = error[key];
    if (typeof value === "string") summary[key] = capped(value);
    else if (typeof value === "number") summary[key] = value;
  }
  return summary;
}

function safeToLog(detail: unknown): unknown {
  if (typeof detail === "string") return capped(detail);
  if (isErrorLike(detail)) return summariseError(detail);
  return detail;
}

/**
 * Logs a failure under its reference in the one shape every failure uses
 * (`API call failed (ref: ABC123)`), so a reference a user reports can be
 * found. This is the single choke point for failure logs: any error-like
 * argument is reduced to name, code, status and message (see
 * `isErrorLike`), and strings are capped at 500 characters (the gm-assistant
 * client's own 500-character gateway body slice passes whole). Other
 * detail objects are logged as given. Pass details only; never request
 * bodies, auth headers or tokens.
 */
export function logFailureReference(ref: string, ...details: unknown[]): void {
  console.error(`API call failed (ref: ${ref})`, ...details.map(safeToLog));
}

/** The reference already remembered for this error, if any. */
export function loggedReferenceOf(error: unknown): string | null {
  return typeof error === "object" && error !== null
    ? (loggedReferences.get(error) ?? null)
    : null;
}

/**
 * The reference to show for a failure, so it always matches one log line:
 * the one already remembered for this error (for example logged by
 * `createApiFunction`), else a newly minted one logged now with `details`.
 * Details never include post text, image data or tokens.
 */
export function shownReference(error: unknown, ...details: unknown[]): string {
  const known = loggedReferenceOf(error);
  if (known) return known;
  const ref = referenceForLogging(error);
  logFailureReference(ref, ...details);
  return ref;
}
