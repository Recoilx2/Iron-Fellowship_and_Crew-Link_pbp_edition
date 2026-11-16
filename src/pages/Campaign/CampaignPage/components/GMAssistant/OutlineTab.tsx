import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { updateNote } from "api-calls/notes/updateNote";
import { getCampaignNoteDocumentName } from "config/hocuspocus.config";
import { RtcRichTextEditor } from "components/shared/RichTextEditor/RtcRichTextEditor";
import { decodeOutlineBytes } from "api-calls/assistant/outlineText";
import { createConversation } from "api-calls/assistant/createConversation";
import {
  extractOutlineProposal,
  streamAssistantChat,
} from "api-calls/assistant/gmAssistantClient";
import {
  fetchOutlineContentBytes,
  undoOutlineRevision,
} from "api-calls/assistant/outlineVersions";
import { listenToOutlineVersions } from "api-calls/assistant/listenToOutlineVersions";
import { logFailureReference, mintErrorReference } from "functions/errorReference";
import { referenceFor, withReference } from "./assistantFailure";
import { useOutlineDocument } from "./useOutlineDocument";
import { OutlineRevision } from "./OutlineRevision";

/**
 * The GM assistant's Outline tab (spec #10, tickets #131 and #133): the
 * campaign's one GM-only outline note, edited with the same editor as
 * other notes. The row is created the first time a GM opens it and shared
 * by all of the campaign's GMs; players never see it (no assistant,
 * hidden rows, refused note-server documents). Bytes sync live through
 * the note server, so co-GMs editing together merge; the title saves
 * through the notes data layer like any other server-persisted note.
 *
 * Revisions (ticket #133): an explicit "Revise outline" action sends the
 * GM's instruction in a dedicated outline-revision mode -- never guessed
 * from the wording -- and the reply previews the current outline beside
 * the proposed complete replacement, with Apply to outline and Discard.
 * Apply asks for confirmation, then replaces the outline through the
 * note server (so this editor and every co-GM's receive it live) and keeps
 * the previous version for Undo, offered here and on the applied preview.
 * Only the GM's Apply or Undo ever changes the outline; Discard leaves it
 * untouched.
 */
export function OutlineTab(props: { campaignId: string }) {
  const { campaignId } = props;
  const { outlineId, bytes, text, loaded, failed, error, reload } =
    useOutlineDocument(campaignId);
  // One reference per failed open: the one already logged for the error
  // (createApiFunction's for the wrapped open call), else one logged now
  // for an unwrapped listener error. Stable until a retry.
  const failedRef = useMemo(
    () => (failed && error ? referenceFor(error) : null),
    [failed, error]
  );
  // The newest kept version: the Outline tab's Undo restores exactly this one.
  const [newestVersionId, setNewestVersionId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    current: string;
    proposed: string;
  } | null>(null);

  useEffect(
    () =>
      listenToOutlineVersions(
        campaignId,
        {
          onVersions: (rows) =>
            setNewestVersionId(
              rows.reduce<(typeof rows)[number] | null>(
                (newest, row) =>
                  !newest || row.createdAt > newest.createdAt ? row : newest,
                null
              )?.id ?? null
            ),
          onLoaded: () => {},
        },
        () => {}
      ),
    [campaignId]
  );

  const save = useCallback(
    (
      _id: string,
      _notes: Uint8Array,
      isBeaconRequest: boolean | undefined,
      title: string | undefined
    ) => {
      if (!outlineId) {
        return Promise.resolve();
      }
      // Server-persisted notes own their bytes on the note server: only
      // the title travels through the data layer, as with other notes.
      return updateNote({
        campaignId,
        characterId: undefined,
        noteId: outlineId,
        title: title ?? "Campaign outline",
        isBeaconRequest,
      });
    },
    [campaignId, outlineId]
  );

  const requestRevision = async (): Promise<void> => {
    const trimmed = instruction.trim();
    if (!trimmed || requesting || !outlineId) {
      return;
    }
    setRequesting(true);
    setRevisionError(null);
    try {
      // The "current" side is read fresh from the note server, so the
      // preview never shows a stale subscription value.
      const stored = await fetchOutlineContentBytes(outlineId).catch(() => null);
      const current = stored ? decodeOutlineBytes(stored) : text;
      const conversationId = await createConversation({ campaignId });
      const result = await streamAssistantChat({
        conversationId,
        message: trimmed,
        mode: "outline-revision",
        signal: new AbortController().signal,
        onChunk: () => {},
      });
      const proposed = extractOutlineProposal(result.text);
      if (!proposed) {
        const ref = mintErrorReference();
        logFailureReference(ref, "reply carried no marked outline revision");
        setRevisionError(
          withReference(
            "The assistant didn't return a marked revision. Try again with a plainer instruction.",
            ref
          )
        );
        return;
      }
      setPreview({ current, proposed });
      setShowForm(false);
      setInstruction("");
    } catch (error) {
      setRevisionError(
        withReference(
          "The revision request failed. Try again.",
          referenceFor(error)
        )
      );
    } finally {
      setRequesting(false);
    }
  };

  const undo = async (): Promise<void> => {
    if (undoing || !outlineId || !newestVersionId) {
      return;
    }
    setUndoing(true);
    setUndoError(null);
    try {
      await undoOutlineRevision({
        campaignId,
        outlineId,
        versionId: newestVersionId,
      });
    } catch (error) {
      setUndoError(
        withReference(
          "The revision couldn't be undone. The outline may not have been changed. Check it and try again.",
          referenceFor(error)
        )
      );
    } finally {
      setUndoing(false);
    }
  };

  if (failed && failedRef) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert
          severity={"error"}
          action={
            <Button size={"small"} onClick={reload}>
              Retry
            </Button>
          }
        >
          {withReference("The assistant couldn't open the outline.", failedRef)}
        </Alert>
      </Box>
    );
  }

  if (!loaded || !outlineId || bytes === undefined) {
    return (
      <Box sx={{ p: 2 }}>
        <LinearProgress aria-label={"Loading outline"} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        flexGrow: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Typography
        variant={"caption"}
        color={"text.secondary"}
        sx={{ px: 1.5, pt: 1 }}
      >
        GM-only. Never shared with players.
      </Typography>
      <Stack direction={"row"} spacing={1} sx={{ px: 1.5, py: 0.5 }}>
        <Button
          size={"small"}
          variant={showForm ? "outlined" : "contained"}
          disabled={requesting}
          onClick={() => setShowForm((open) => !open)}
          aria-label={"Revise outline"}
        >
          Revise outline
        </Button>
        <Button
          size={"small"}
          disabled={newestVersionId === null || undoing}
          onClick={() => void undo()}
          aria-label={"Undo outline revision"}
          title={
            newestVersionId === null
              ? "No kept version to restore"
              : "Restore the previous outline version"
          }
        >
          Undo
        </Button>
      </Stack>
      {undoError && (
        <Box sx={{ px: 1.5, pb: 0.5 }}>
          <Alert severity={"error"} onClose={() => setUndoError(null)}>
            {undoError}
          </Alert>
        </Box>
      )}
      {showForm && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <TextField
            multiline
            fullWidth
            size={"small"}
            placeholder={"How should the outline change?"}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            inputProps={{ "aria-label": "Revision instruction" }}
          />
          <Stack direction={"row"} spacing={1} sx={{ mt: 0.5 }}>
            <Button
              size={"small"}
              variant={"contained"}
              disabled={instruction.trim().length === 0 || requesting}
              onClick={() => void requestRevision()}
              aria-label={"Request outline revision"}
            >
              Request revision
            </Button>
            <Button
              size={"small"}
              disabled={requesting}
              onClick={() => setShowForm(false)}
              aria-label={"Cancel outline revision"}
            >
              Cancel
            </Button>
          </Stack>
        </Box>
      )}
      {requesting && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <LinearProgress aria-label={"Requesting outline revision"} />
        </Box>
      )}
      {revisionError && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <Alert severity={"error"} onClose={() => setRevisionError(null)}>
            {revisionError}
          </Alert>
        </Box>
      )}
      {preview && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <OutlineRevision
            campaignId={campaignId}
            outlineId={outlineId}
            current={preview.current}
            proposed={preview.proposed}
            onDiscard={() => setPreview(null)}
          />
        </Box>
      )}
      <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <RtcRichTextEditor
          key={outlineId}
          id={outlineId}
          documentName={getCampaignNoteDocumentName(outlineId)}
          initialValue={bytes ?? undefined}
          showTitle
          serverPersisted
          onSave={save}
        />
      </Box>
    </Box>
  );
}
