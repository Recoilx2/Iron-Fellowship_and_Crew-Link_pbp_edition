import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import {
  getCampaignNoteDocumentName,
  getHocuspocusToken,
  getHocuspocusUrl,
} from "config/hocuspocus.config";
import { readOutlineFromDoc, replaceOutlineInDoc } from "./outlineText";

/**
 * A short-lived editing session on the outline through the note server
 * (ticket #147). Apply and Undo used to write the outline bytes over REST,
 * which the note server never sees: it keeps its in-memory copy of an open
 * outline and later writes that copy back, silently reverting the write.
 * Going through the server as one more collaborator means every open
 * editor (a co-GM's, the Outline tab's) receives the change live and the
 * server persists it itself.
 */

const SYNC_TIMEOUT_MS = 15000;
const ACK_TIMEOUT_MS = 15000;

export interface OutlineSession {
  /** The outline text as the note server holds it right now. */
  text(): string;
  /** Replaces the outline text; resolves once the server has it. */
  replace(text: string): Promise<void>;
  close(): void;
}

export async function openOutlineSession(
  outlineId: string
): Promise<OutlineSession> {
  const doc = new Y.Doc();
  let onAcknowledged: (() => void) | null = null;
  let onSynced: (() => void) | null = null;
  let onRefused: ((reason: string) => void) | null = null;

  const provider = new HocuspocusProvider({
    url: getHocuspocusUrl(),
    name: getCampaignNoteDocumentName(outlineId),
    document: doc,
    token: getHocuspocusToken,
    onSynced: () => onSynced?.(),
    onUnsyncedChanges: ({ number }) => {
      if (number === 0) onAcknowledged?.();
    },
    onAuthenticationFailed: ({ reason }) =>
      onRefused?.(reason ?? "not authorized"),
  });

  const close = (): void => {
    try {
      provider.destroy();
      doc.destroy();
    } catch {
      // Already closed.
    }
  };

  const waitFor = (
    arm: (done: () => void, fail: (reason: string) => void) => void,
    timeoutMs: number,
    what: string
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`The note server did not ${what} in time.`)),
        timeoutMs
      );
      arm(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (reason) => {
          clearTimeout(timer);
          reject(new Error(`The note server refused the outline: ${reason}`));
        }
      );
    });

  try {
    await waitFor(
      (done, fail) => {
        onSynced = done;
        onRefused = fail;
      },
      SYNC_TIMEOUT_MS,
      "sync the outline"
    );
  } catch (error) {
    close();
    throw error;
  }

  return {
    text: () => readOutlineFromDoc(doc),
    replace: async (text) => {
      replaceOutlineInDoc(doc, text);
      if (!provider.hasUnsyncedChanges) {
        return;
      }
      await waitFor(
        (done) => {
          onAcknowledged = done;
          if (!provider.hasUnsyncedChanges) done();
        },
        ACK_TIMEOUT_MS,
        "confirm the outline change"
      );
    },
    close,
  };
}
