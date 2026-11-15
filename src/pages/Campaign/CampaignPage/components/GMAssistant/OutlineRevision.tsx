import { useState } from "react";

import {
  applyOutlineRevision,
  undoOutlineRevision,
} from "api-calls/assistant/outlineVersions";
import { referenceFor, withReference } from "./assistantFailure";
import { OutlineRevisionPreview } from "./OutlineRevisionPreview";

/**
 * A live outline revision (ticket #133): the side-by-side preview wired to
 * Apply (confirmation first, previous version kept) and Undo. The Outline
 * tab and the Chat thread both render this for a proposal; Discard leaves
 * the outline untouched and only tells the parent to hide the preview.
 * Failures show a short message; the data layer's thrown error stays out
 * of the UI. After every successful Apply or Undo the parent learns the
 * new outline text, so it can move its editor onto it at once.
 */
export function OutlineRevision(props: {
  campaignId: string;
  outlineId: string;
  current: string;
  proposed: string;
  onDiscard: () => void;
  onReplaced?: (text: string) => void;
}) {
  const { campaignId, outlineId, current, proposed, onDiscard, onReplaced } =
    props;
  const [applied, setApplied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (): Promise<void> => {
    if (applying) {
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await applyOutlineRevision({
        campaignId,
        outlineId,
        currentText: current,
        proposedText: proposed,
      });
      setApplied(true);
      onReplaced?.(proposed);
    } catch (error) {
      setError(
        withReference(
          "The outline couldn't be replaced. Retry, or discard.",
          referenceFor(error)
        )
      );
    } finally {
      setApplying(false);
    }
  };

  const undo = async (): Promise<void> => {
    if (undoing) {
      return;
    }
    setUndoing(true);
    setError(null);
    try {
      const restored = await undoOutlineRevision({ campaignId, outlineId });
      setApplied(false);
      onReplaced?.(restored);
    } catch (error) {
      setError(
        withReference(
          "The revision couldn't be undone. Nothing was changed.",
          referenceFor(error)
        )
      );
    } finally {
      setUndoing(false);
    }
  };

  return (
    <OutlineRevisionPreview
      current={current}
      proposed={proposed}
      applied={applied}
      applying={applying}
      applyError={error}
      undoing={undoing}
      onApply={() => void apply()}
      onDiscard={onDiscard}
      onUndo={() => void undo()}
    />
  );
}
