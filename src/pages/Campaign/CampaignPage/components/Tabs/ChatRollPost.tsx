import { useState } from "react";
import { Box, Collapse } from "@mui/material";
import DiceIcon from "@mui/icons-material/Casino";
import type { PostWithId } from "api-calls/chat/listenToChannelPosts";
import type { Roll } from "types/DieRolls.type";
import { RollDisplay } from "components/features/charactersAndCampaigns/RollDisplay";
import { getRollTitle } from "functions/rollText";
import { getChatRollSummary } from "functions/chatRolls";

/**
 * A roll post in the feed (spec #9, prototype variant D): a dark one-line
 * summary beside the roll's title, with a coloured left edge -- orange
 * when only GMs may see it. Tapping the line expands the existing roll
 * card; screen readers get the whole roll as sentences from the card.
 */
export function ChatRollPost(props: { post: PostWithId & { roll: Roll } }) {
  const { post } = props;
  const { roll } = post;
  const [expanded, setExpanded] = useState(false);
  const title = getRollTitle(roll);
  const summary = getChatRollSummary(roll);
  return (
    <Box sx={{ mt: 0.5 }}>
      <Box
        component={"button"}
        type={"button"}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={`${title}: ${summary}${
          post.gmsOnly ? ", GM only" : ""
        }`}
        sx={(theme) => ({
          display: "inline-flex",
          alignItems: "center",
          gap: 1,
          border: 0,
          borderRadius: 1,
          px: 1.25,
          py: 0.75,
          cursor: "pointer",
          font: "inherit",
          textAlign: "start",
          bgcolor: theme.palette.darkGrey.dark,
          color: theme.palette.darkGrey.contrastText,
          borderLeft: 4,
          borderLeftStyle: "solid",
          borderLeftColor: post.gmsOnly
            ? theme.palette.warning.main
            : theme.palette.primary.main,
        })}
      >
        <DiceIcon fontSize={"small"} />
        <span>{title}</span>
        <b>{summary}</b>
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ mt: 1, maxWidth: 420 }}>
          <RollDisplay roll={roll} isExpanded />
        </Box>
      </Collapse>
    </Box>
  );
}
