import { AssistantRequestError } from "api-calls/assistant/gmAssistantClient";
import { shownReference } from "functions/errorReference";

export interface AssistantFailure {
  code: string;
  message: string;
  ref: string;
}

const GENERIC_MESSAGE = "The assistant request failed.";

/**
 * Fixed client text per server code, covering every code the gm-assistant
 * function sends. Server or gateway wording never reaches the screen.
 */
const MESSAGES_BY_CODE: Record<string, string> = {
  NOT_SET_UP: "The assistant isn't set up on this server.",
  FORBIDDEN: "Only a GM of this campaign can use the assistant.",
  UNAUTHORIZED: "Sign in again and retry.",
  INVALID_REQUEST: "The assistant couldn't handle that request.",
  CONVERSATION_NOT_FOUND: "That conversation wasn't found.",
  UPSTREAM_ERROR: GENERIC_MESSAGE,
  PAYLOAD_TOO_LARGE: "That request was too large.",
};

function messageForCode(code: string): string {
  return Object.prototype.hasOwnProperty.call(MESSAGES_BY_CODE, code)
    ? MESSAGES_BY_CODE[code]
    : GENERIC_MESSAGE;
}

/**
 * Turns anything thrown on an assistant path into what the GM may see (story
 * 38): fixed client text plus a reference. The text comes from the error's
 * code, never from the error's own message; an AssistantRequestError keeps
 * the server's `ref`. Any other failure (for example "Failed to fetch")
 * gets the generic message. The reference is the one already logged for
 * the error when there is one (see `createApiFunction`), else a new one.
 */
export function toAssistantFailure(error: unknown): AssistantFailure {
  if (error instanceof AssistantRequestError) {
    return {
      code: error.code,
      message: messageForCode(error.code),
      ref: error.ref ?? shownReference(error, error),
    };
  }
  return {
    code: "UPSTREAM_ERROR",
    message: GENERIC_MESSAGE,
    ref: shownReference(error, error),
  };
}

/**
 * The reference to show for a thrown error: the server's when it gave one,
 * else the one already logged for it, else a new one.
 */
export function referenceFor(error: unknown): string {
  return error instanceof AssistantRequestError && error.ref
    ? error.ref
    : shownReference(error, error);
}

/** `message (ref: ABC123)`, the shape every assistant error is shown in. */
export function withReference(message: string, ref: string): string {
  return `${message} (ref: ${ref})`;
}
