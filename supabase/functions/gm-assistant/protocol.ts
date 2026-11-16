/**
 * The GM assistant's wire protocol: the one shared source for everything
 * the browser client and the gm-assistant server function must agree on
 * (ticket #151). Both sides import this file, so the outline-proposal
 * markers, the approximate token estimate, the context-reference types
 * and the function's route paths cannot drift between them.
 *
 * Dependency-free on purpose: the server side runs in the Edge Runtime
 * (web-standard APIs only, no npm imports), so this module may use
 * nothing but the language itself.
 */

// -- Routes ----------------------------------------------------------------

/** `GET` — the endpoint's model list, filtered by the operator's allow-list. */
export const GM_ASSISTANT_MODELS_PATH = "/gm-assistant/models";
/** `GET`/`POST` — per-item context sizes (saved choice, or a preview list). */
export const GM_ASSISTANT_CONTEXT_SIZE_PATH = "/gm-assistant/context-size";
/** `POST` — one chat turn, streamed back as server-sent events. */
export const GM_ASSISTANT_CHAT_PATH = "/gm-assistant/chat";

/** Every route the gm-assistant function serves. */
export const GM_ASSISTANT_PATHS = [
  GM_ASSISTANT_MODELS_PATH,
  GM_ASSISTANT_CONTEXT_SIZE_PATH,
  GM_ASSISTANT_CHAT_PATH,
] as const;

/** True when the pathname is one of the function's routes. */
export function isGmAssistantPath(pathname: string): boolean {
  return (GM_ASSISTANT_PATHS as readonly string[]).includes(pathname);
}

// -- Outline proposals -----------------------------------------------------

/**
 * Markers wrapping a complete replacement outline in an outline-revision
 * reply (ticket #133). The server asks the model to put the replacement
 * between these markers on their own lines with nothing else outside, so
 * the client can pull it out reliably; `extractOutlineProposal` does the
 * pulling on both sides of the wire.
 */
export const OUTLINE_PROPOSAL_BEGIN = "<<<OUTLINE-BEGIN>>>";
export const OUTLINE_PROPOSAL_END = "<<<OUTLINE-END>>>";

/**
 * Pulls the proposed outline from an assistant reply: the text between
 * the first begin marker and the last end marker, trimmed. Null when the
 * reply carries no complete proposal (a marker missing or nothing
 * between them).
 */
export function extractOutlineProposal(reply: string): string | null {
  const start = reply.indexOf(OUTLINE_PROPOSAL_BEGIN);
  const end = reply.lastIndexOf(OUTLINE_PROPOSAL_END);
  if (start < 0 || end < 0 || end <= start + OUTLINE_PROPOSAL_BEGIN.length) {
    return null;
  }
  const proposed = reply
    .slice(start + OUTLINE_PROPOSAL_BEGIN.length, end)
    .trim();
  return proposed.length > 0 ? proposed : null;
}

/** What the GM asked for: a normal chat turn or a dedicated outline revision. */
export type AssistantRequestMode = "chat" | "outline-revision";

// -- Sizes -----------------------------------------------------------------

/**
 * Approximate tokens for a character count (ticket #132): four characters
 * per token, rounded up. Both sides use this exact formula, so the panel's
 * size bar and the server's answer agree; exact per-model tokenising is
 * not needed.
 */
export function approximateTokensForChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

// -- Context references ----------------------------------------------------

/**
 * What the GM lets the assistant read (spec #10): references only, never
 * text. The server builds the actual context from these at request time,
 * reading every row with the caller's JWT, so a reference the GM can no
 * longer read is skipped, never leaked.
 */
export interface AssistantItemReference {
  id: string;
  includeGmParts: boolean;
}

export interface AssistantChannelReference {
  id: string;
  postCount: number;
}

export interface AssistantContextChoice {
  includeOutline: boolean;
  lore: AssistantItemReference[];
  npcs: AssistantItemReference[];
  locations: AssistantItemReference[];
  notes: string[];
  channels: AssistantChannelReference[];
}

/** A context choice with nothing included: the starting point. */
export function emptyAssistantContextChoice(): AssistantContextChoice {
  return {
    includeOutline: false,
    lore: [],
    npcs: [],
    locations: [],
    notes: [],
    channels: [],
  };
}
