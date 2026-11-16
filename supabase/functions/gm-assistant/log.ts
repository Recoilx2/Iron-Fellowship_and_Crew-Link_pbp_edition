/**
 * The single choke point for the gm-assistant's server error logs (ticket
 * #183): every line carries a reference, in the same `[gm-assistant] ref=`
 * shape as the error responses, and every free-text fragment is sanitized
 * here so no conversation or user id, URL or secret can reach a log line.
 * Raw `console.error`/`console.warn` are banned in this function by lint;
 * server errors go through this helper (the client-side twin is
 * `src/functions/errorReference.ts`).
 */
import { mintReference } from "./security.ts";

const MAX_DETAIL_LENGTH = 300;
const MAX_CODE_LENGTH = 64;

/** A UUID anywhere in a fragment is an id: it never logs as itself. */
const UUID_ANYWHERE =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/** A URL can carry ids, tokens or a key in its query: never logged raw. */
const URL_ANYWHERE = /[a-z][a-z0-9+.-]*:\/\/\S+|https?:\/\/\S+/gi;

/**
 * Reduces a fragment to a safe one: control characters are stripped (so a
 * hostile string cannot forge extra log lines), whitespace collapses, URLs
 * and UUID-shaped ids become placeholders, and the result is capped.
 * Callers pass only static text; this is defense in depth, not licence.
 */
function sanitizeFragment(text: string, maxLength: number): string {
  return text
    // Replacing control characters with a space is the point: a newline
    // in a hostile detail must not forge a second log line.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(URL_ANYWHERE, "[url]")
    .replace(UUID_ANYWHERE, "[id]")
    .slice(0, maxLength);
}

/**
 * Logs one server error line and returns the reference it carries. The
 * reference is the caller's when one exists (so the log line and the body
 * a GM sees stay the same, as in `errorResponse`), else a freshly minted
 * one. `status` and `route` are structured fields; `detail` is the only
 * free text, and it is sanitized before it logs.
 */
export function logServerError(
  code: string,
  detail: string,
  context?: { status?: number; route?: string; ref?: string },
): string {
  const ref = context?.ref ?? mintReference();
  const parts = [
    `[gm-assistant] ref=${ref}`,
    `code=${sanitizeFragment(code, MAX_CODE_LENGTH)}`,
  ];
  if (context?.status !== undefined) {
    parts.push(`status=${context.status}`);
  }
  if (context?.route !== undefined) {
    parts.push(`route=${sanitizeFragment(context.route, MAX_CODE_LENGTH)}`);
  }
  const safeDetail = sanitizeFragment(detail, MAX_DETAIL_LENGTH);
  if (safeDetail) {
    parts.push(`detail=${safeDetail}`);
  }
  console.error(parts.join(" "));
  return ref;
}
