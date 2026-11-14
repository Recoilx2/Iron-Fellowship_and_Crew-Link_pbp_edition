import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, LinearProgress, Typography } from "@mui/material";
import { getOrCreateCampaignOutline } from "api-calls/notes/campaignOutline";
import { listenToNoteContent } from "api-calls/notes/listenToNoteContent";
import { updateNote } from "api-calls/notes/updateNote";
import { getCampaignNoteDocumentName } from "config/hocuspocus.config";
import { RtcRichTextEditor } from "components/shared/RichTextEditor/RtcRichTextEditor";

/**
 * The GM assistant's Outline tab (spec #10, ticket #131): the campaign's
 * one GM-only outline note, edited with the same editor as other notes.
 * The row is created the first time a GM opens it and shared by all of
 * the campaign's GMs; players never see it (no assistant, hidden rows,
 * refused note-server documents). Bytes sync live through the note
 * server, so co-GMs editing together merge; the title saves through the
 * notes data layer like any other server-persisted note.
 */
export function OutlineTab(props: { campaignId: string }) {
  const { campaignId } = props;
  const [outlineId, setOutlineId] = useState<string | null>(null);
  const [content, setContent] = useState<Uint8Array | null | undefined>(
    undefined
  );
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOutlineId(null);
    setContent(undefined);
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
      (bytes) => setContent(bytes ?? null),
      () => setFailed(true)
    );
  }, [campaignId, outlineId, reloads]);

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

  if (failed) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert
          severity={"error"}
          action={
            <Button size={"small"} onClick={() => setReloads((n) => n + 1)}>
              Retry
            </Button>
          }
        >
          The assistant couldn&apos;t open the outline.
        </Alert>
      </Box>
    );
  }

  if (!outlineId || content === undefined) {
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
      <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <RtcRichTextEditor
          id={outlineId}
          documentName={getCampaignNoteDocumentName(outlineId)}
          initialValue={content ?? undefined}
          showTitle
          serverPersisted
          onSave={save}
        />
      </Box>
    </Box>
  );
}
