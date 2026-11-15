import { AssistantRequestError } from "api-calls/assistant/gmAssistantClient";
import { mintErrorReference } from "functions/errorReference";

export interface AssistantFailure {
  code: string;
  message: string;
  ref: string;
}

/**
 * Turns anything thrown on an assistant path into what the GM may see (story
 * 38): a generic message plus a reference. An AssistantRequestError already
 * carries a generic message (the server's or a fixed one) and the server's
 * reference, so both are kept; the server's `ref` is never replaced by a
 * newly minted one. Any other failure (for example "Failed to fetch") gets
 * the generic message and a minted reference; its own text never reaches
 * the screen.
 */
export function toAssistantFailure(error: unknown): AssistantFailure {
  if (error instanceof AssistantRequestError) {
    return {
      code: error.code,
      message: error.message,
      ref: error.ref ?? mintErrorReference(),
    };
  }
  return {
    code: "UPSTREAM_ERROR",
    message: "The assistant request failed.",
    ref: mintErrorReference(),
  };
}

/** The reference of a thrown error when the server gave one, else a new one. */
export function referenceFor(error: unknown): string {
  return error instanceof AssistantRequestError && error.ref
    ? error.ref
    : mintErrorReference();
}

/** `message (ref: ABC123)`, the shape every assistant error is shown in. */
export function withReference(message: string, ref: string): string {
  return `${message} (ref: ${ref})`;
}
