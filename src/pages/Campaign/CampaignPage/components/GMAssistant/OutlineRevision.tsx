import { useState } from "react";

import type { AssistantProposalState } from "api-calls/assistant/_assistant.type";
import {
  applyOutlineRevision,
  OutlineVersionGoneError,
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
 * of the UI. The outcome can be remembered by the parent (ticket #148):
 * `proposal` is what was saved for this proposal and `onProposalChange` is
 * told after every Apply, Discard and Undo. Undo names the version this
 * proposal's own Apply kept, so it never reverts a later Apply by someone
 * else. The editor needs no nudge afterwards: Apply and Undo go
 * through the note server, so every open editor receives the change live.
 */
export interface ProposalOutcome {
  state: AssistantProposalState | null;
  /** The outline version the proposal's Apply kept, for Undo. */
  appliedVersionId: string | null;
}

export function OutlineRevision(props: {
  campaignId: string;
  outlineId: string;
  current: string;
  proposed: string;
  /** The saved outcome, when the proposal was acted on before. */
  proposal?: ProposalOutcome;
  /** Saves the outcome; a rejection shows a reference, nothing else changes. */
  onProposalChange?: (outcome: ProposalOutcome) => Promise<void>;
  onDiscard: () => void;
}) {
  const {
    campaignId,
    outlineId,
    current,
    proposed,
    proposal,
    onProposalChange,
    onDiscard,
  } = props;
  // What this view did wins over the saved outcome it started from.
  const [outcome, setOutcome] = useState<ProposalOutcome | null>(null);
  const shown: ProposalOutcome = outcome ??
    proposal ?? { state: null, appliedVersionId: null };
  const applied = shown.state === "applied";
  const versionId = shown.appliedVersionId;
  const [applying, setApplying] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remember = async (next: ProposalOutcome): Promise<void> => {
    setOutcome(next);
    try {
      await onProposalChange?.(next);
    } catch (error) {
      setError(
        withReference(
          "The panel couldn't remember this. It may offer the revision again after a reload.",
          referenceFor(error)
        )
      );
    }
  };

  const apply = async (): Promise<void> => {
    if (applying) {
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const kept = await applyOutlineRevision({
        campaignId,
        outlineId,
        currentText: current,
        proposedText: proposed,
      });
      await remember({ state: "applied", appliedVersionId: kept ?? null });
    } catch (error) {
      setError(
        withReference(
          "The outline couldn't be replaced. Check the outline, then retry or discard.",
          referenceFor(error)
        )
      );
    } finally {
      setApplying(false);
    }
  };

  const undo = async (): Promise<void> => {
    if (undoing || !versionId) {
      return;
    }
    setUndoing(true);
    setError(null);
    try {
      await undoOutlineRevision({ campaignId, outlineId, versionId });
      await remember({ state: null, appliedVersionId: null });
    } catch (error) {
      if (error instanceof OutlineVersionGoneError) {
        // Already undone or pruned: nothing changed, and Undo is moot.
        setOutcome({ state: "applied", appliedVersionId: null });
        setError(
          withReference(
            "That version is no longer available, so the outline wasn't changed.",
            referenceFor(error)
          )
        );
        return;
      }
      setError(
        withReference(
          "The revision couldn't be undone. The outline may not have been changed. Check it and try again.",
          referenceFor(error)
        )
      );
    } finally {
      setUndoing(false);
    }
  };

  const discard = async (): Promise<void> => {
    await remember({ state: "dismissed", appliedVersionId: null });
    onDiscard();
  };

  return (
    <OutlineRevisionPreview
      current={current}
      proposed={proposed}
      applied={applied}
      applying={applying}
      applyError={error}
      undoing={undoing}
      canUndo={versionId !== null}
      onApply={() => void apply()}
      onDiscard={() => void discard()}
      onUndo={() => void undo()}
    />
  );
}
