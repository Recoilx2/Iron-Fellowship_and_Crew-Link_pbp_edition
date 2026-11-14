import { useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";

/**
 * Side-by-side preview of an outline revision (spec #10, ticket #133,
 * layout from #7): the current outline beside the assistant's proposed
 * complete replacement, with Apply to outline and Discard. Apply asks for
 * confirmation first, then the parent replaces the outline and keeps the
 * previous version for Undo; after applying, the preview offers Undo
 * instead. Nothing here writes anything itself: the parent's callbacks do
 * the version-keeping and the replacing.
 */
export function OutlineRevisionPreview(props: {
  current: string;
  proposed: string;
  /** True once the parent applied this proposal to the outline. */
  applied: boolean;
  applying: boolean;
  applyError: string | null;
  undoing: boolean;
  onApply: () => void;
  onDiscard: () => void;
  onUndo: () => void;
}) {
  const {
    current,
    proposed,
    applied,
    applying,
    applyError,
    undoing,
    onApply,
    onDiscard,
    onUndo,
  } = props;
  const [confirming, setConfirming] = useState(false);

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 1,
        mt: 1,
      }}
      aria-label={"Outline revision preview"}
    >
      <Stack direction={"row"} spacing={1} sx={{ flexWrap: "wrap" }}>
        <Box sx={{ flex: "1 1 200px", minWidth: 0 }}>
          <Typography variant={"subtitle2"}>Current outline</Typography>
          <Typography
            variant={"body2"}
            sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}
            aria-label={"Current outline text"}
          >
            {current || "(The outline is empty.)"}
          </Typography>
        </Box>
        <Box sx={{ flex: "1 1 200px", minWidth: 0 }}>
          <Typography variant={"subtitle2"}>Proposed outline</Typography>
          <Typography
            variant={"body2"}
            sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}
            aria-label={"Proposed outline text"}
          >
            {proposed}
          </Typography>
        </Box>
      </Stack>
      {applyError && (
        <Alert severity={"error"} sx={{ mt: 1 }}>
          {applyError}
        </Alert>
      )}
      {applied ? (
        <Stack direction={"row"} spacing={1} alignItems={"center"} sx={{ mt: 1 }}>
          <Alert severity={"success"} sx={{ flexGrow: 1 }}>
            Applied. The previous version is kept for Undo.
          </Alert>
          <Button
            size={"small"}
            disabled={undoing}
            onClick={onUndo}
            aria-label={"Undo outline revision"}
          >
            Undo
          </Button>
        </Stack>
      ) : confirming ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant={"body2"}>
            Replace the outline? The current version is kept for Undo.
          </Typography>
          <Stack direction={"row"} spacing={1} sx={{ mt: 0.5 }}>
            <Button
              size={"small"}
              variant={"contained"}
              disabled={applying}
              onClick={onApply}
              aria-label={"Confirm replace outline"}
            >
              Confirm replace
            </Button>
            <Button
              size={"small"}
              disabled={applying}
              onClick={() => setConfirming(false)}
              aria-label={"Cancel applying outline revision"}
            >
              Cancel
            </Button>
          </Stack>
        </Box>
      ) : (
        <Stack direction={"row"} spacing={1} sx={{ mt: 1 }}>
          <Button
            size={"small"}
            variant={"contained"}
            disabled={applying}
            onClick={() => setConfirming(true)}
            aria-label={"Apply to outline"}
          >
            Apply to outline
          </Button>
          <Button
            size={"small"}
            disabled={applying}
            onClick={onDiscard}
            aria-label={"Discard outline revision"}
          >
            Discard
          </Button>
        </Stack>
      )}
    </Box>
  );
}
