/**
 * HTTP contract helpers for the GM assistant function: CORS echoing only
 * the site's own origin, and the generic-error response (spec #10, story
 * 29). Split out of `handler.ts` (ticket #151).
 */
import type { GmAssistantEnv } from "./env.ts";

export function corsHeaders(req: Request, env: GmAssistantEnv): Headers {
  const headers = new Headers();
  const origin = req.headers.get("origin");
  if (origin && env.siteUrl && origin === env.siteUrl) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

/**
 * Only the error's class name is ever logged: thrown fetch errors carry the
 * full request URL, which can hold user ids or an API key. A name that is
 * not a short plain word reads as "Error", so a hostile name cannot smuggle
 * text into the log; a non-Error throw keeps its old "unknown" label.
 */
export function errorName(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const name = error.name;
  return /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
}

export function errorResponse(
  req: Request,
  env: GmAssistantEnv,
  status: number,
  code: string,
  message: string,
  ref: string,
  detailForLog?: string,
): Response {
  // One line per error response, so every reference a GM sees can be found
  // in the server log. Only the reference, code, status, method and path are
  // logged, plus the optional server-side detail: never the request body,
  // headers, token, prompt text or user ids.
  const path = new URL(req.url).pathname;
  const detail = detailForLog
    ? ` detail=${detailForLog
        .replace(/\s+/g, " ")
        // Stripping control characters from the log line is the point.
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, 300)}`
    : "";
  console.error(
    `[gm-assistant] ref=${ref} code=${code} status=${status} route=${req.method} ${path}${detail}`,
  );
  const headers = corsHeaders(req, env);
  headers.set("Content-Type", "application/json");
  return Response.json({ code, message, ref }, { status, headers });
}

/**
 * Reads a request body as text, giving up once more than `maxBytes` have
 * arrived — also for chunked bodies with no Content-Length, where reading
 * the whole body first would buffer a huge payload before any size check
 * (ticket #163). Returns null when the cap is exceeded; the caller answers
 * 413. The count is bytes, not characters, so the cap matches a
 * Content-Length check exactly.
 */
export async function readBodyCapped(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}
