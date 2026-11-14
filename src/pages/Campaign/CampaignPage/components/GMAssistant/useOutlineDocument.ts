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
export function useOutlineDocument(campaignId: string) {
  const [outlineId, setOutlineId] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOutlineId(null);
    setBytes(undefined);
    setFailed(false);
    getOrCreateCampaignOutline({ campaignId })
      .then((id) => {
        if (!cancelled) {
          setOutlineId(id);
        }
      })
      .catch(() => {
        if (!cancelled) {
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
      () => setFailed(true)
    );
  }, [campaignId, outlineId, reloads]);

  return {
    outlineId,
    bytes,
    text: bytes ? decodeOutlineBytes(bytes) : "",
    loaded: outlineId !== null && bytes !== undefined,
    failed,
    reload: () => setReloads((n) => n + 1),
    /**
     * Replaces the known bytes without a round trip (after the GM's Apply
     * or Undo already wrote them): the editor remounts onto the new text
     * at once, and the note server converges through the usual sync.
     */
    overrideBytes: (next: Uint8Array) => setBytes(next),
  };
}
