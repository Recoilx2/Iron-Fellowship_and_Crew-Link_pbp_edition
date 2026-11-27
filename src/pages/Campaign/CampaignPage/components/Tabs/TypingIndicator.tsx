import { Typography } from "@mui/material";

/**
 * Typing presence for the open channel (ticket #204). The live region stays
 * in the DOM even when empty: screen readers announce text inserted into an
 * existing `aria-live` region, not a region created with its text already
 * there. Names are resolved and reader-filtered by useChannelTyping; this
 * component only formats them.
 */
function formatTypingNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.length} people are typing…`;
}

export function TypingIndicator(props: { typingNames: string[] }) {
  return (
    <Typography
      variant={"caption"}
      color={"text.secondary"}
      aria-live={"polite"}
      data-testid={"typing-indicator"}
      sx={{ display: "block", minHeight: 18, px: 0.5, pb: 0.5 }}
    >
      {formatTypingNames(props.typingNames)}
    </Typography>
  );
}
