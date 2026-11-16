/**
 * Handler options for the GM assistant function. Split out of
 * `handler.ts` (ticket #151) so `chat.ts` can take the type without
 * importing the router (which imports `chat.ts`).
 */

export interface GmAssistantHandlerOptions {
  /**
   * Milliseconds between SSE comment heartbeats (`: ping`) while a reply
   * streams. Heartbeats let the runtime notice a hung-up browser even when
   * the upstream sends nothing, and they defeat proxy idle timeouts on slow
   * models. Browsers and the repo's SSE parsers ignore comment lines.
   */
  heartbeatMs?: number;
}
