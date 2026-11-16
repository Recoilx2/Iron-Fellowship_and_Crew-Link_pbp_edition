import { useEffect, useState } from "react";

import { getOrCreateCampaignOutline } from "api-calls/notes/campaignOutline";
import { listenToNoteContent } from "api-calls/notes/listenToNoteContent";
import { decodeOutlineBytes } from "api-calls/assistant/outlineText";

/**
 * The campaign's outline document for revision previews and Undo (ticket
 * #133): the outline row id (created on first use, like the Outline tab),
 * its raw note-server bytes, and the decoded plain text the side-by-side
 * preview shows as "current". Bytes stay live through the note
 * subscription, so an Apply or Undo from any of the campaign's GMs moves
 * the text everywhere without a reload.
 */
function asObject(caught: unknown): object {
  return typeof caught === "object" && caught !== null
    ? caught
    : new Error("Outline failed.");
}

export function useOutlineDocument(campaignId: string) {
  const [outlineId, setOutlineId] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // The caught error, so the panel can show the reference already logged
  // for it. Always an object, so that reference sticks to it.
  const [error, setError] = useState<object | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOutlineId(null);
    setBytes(undefined);
    setFailed(false);
    setError(null);
    getOrCreateCampaignOutline({ campaignId })
      .then((id) => {
        if (!cancelled) {
          setOutlineId(id);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(asObject(caught));
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, reloads]);

  useEffect(() => {
    if (!outlineId) {
      return;
    }
    return listenToNoteContent(
      campaignId,
      undefined,
      outlineId,
      (content) => setBytes(content ?? null),
      (caught: unknown) => {
        setError(asObject(caught));
        setFailed(true);
      }
    );
  }, [campaignId, outlineId, reloads]);

  return {
    outlineId,
    bytes,
    text: bytes ? decodeOutlineBytes(bytes) : "",
    loaded: outlineId !== null && bytes !== undefined,
    failed,
    error,
    reload: () => setReloads((n) => n + 1),
  };
}
