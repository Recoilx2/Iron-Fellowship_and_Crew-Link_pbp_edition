import { useState } from "react";
import { Box, Button, Collapse } from "@mui/material";
import DiceIcon from "@mui/icons-material/Casino";
import type { PostWithId } from "api-calls/chat/listenToChannelPosts";
import type { Roll } from "types/DieRolls.type";
import { ROLL_TYPE } from "types/DieRolls.type";
import { RollDisplay } from "components/features/charactersAndCampaigns/RollDisplay";
import { getRollTitle } from "functions/rollText";
import { getChatRollSummary } from "functions/chatRolls";
import { isMomentumBurnUseful, burnMomentumResult } from "functions/momentumBurn";
import { burnPostMomentum } from "api-calls/chat/burnPostMomentum";
import { useSnackbar } from "providers/SnackbarProvider";
import type { CharacterDocument } from "api-calls/character/_character.type";
import { getRollResultLabel } from "components/features/charactersAndCampaigns/RollDisplay/getRollResultLabel";

/**
 * A roll post in the feed (spec #9, prototype variant D): a dark one-line
 * summary beside the roll's title, with a coloured left edge -- orange
 * when only GMs may see it. Tapping the line expands the existing roll
 * card; screen readers get the whole roll as sentences from the card. The
 * author may burn momentum on their own posted action roll when the burn
 * would change the outcome; the burned result arrives live for everyone.
 */
export function ChatRollPost(props: {
  post: PostWithId & { roll: Roll };
  uid?: string;
  characterMap?: Record<string, CharacterDocument>;
}) {
  const { post, uid, characterMap } = props;
  const { roll } = post;
  const [expanded, setExpanded] = useState(false);
  const [burning, setBurning] = useState(false);
  const { success } = useSnackbar();
  const title = getRollTitle(roll);
  const summary = getChatRollSummary(roll);

  // Author-only, own character, at most once, never on NPC or GM-self
  // voices and never on deleted posts. GM-only stays GM-only: the burn
  // never flips the flag.
  const speakerCharacter =
    post.speakerCharacterId != null
      ? characterMap?.[post.speakerCharacterId]
      : undefined;
  const canBurn =
    !post.deletedAt &&
    roll.type === ROLL_TYPE.STAT &&
    roll.momentumBurned === undefined &&
    uid != null &&
    post.authorId === uid &&
    post.speakerCharacterId != null &&
    post.speakerNpcId == null &&
    speakerCharacter?.uid === uid &&
    speakerCharacter != null &&
    isMomentumBurnUseful(roll, speakerCharacter.momentum);

  const burn = () => {
    if (!canBurn || burning || roll.type !== ROLL_TYPE.STAT) {
      return;
    }
    const momentum = speakerCharacter?.momentum ?? 0;
    const newResult = burnMomentumResult(roll, momentum);
    setBurning(true);
    burnPostMomentum({ postId: post.id })
      .then(() => {
        success(
          `Burned momentum. ${title} is now a ${getRollResultLabel(newResult)}.`
        );
      })
      .catch(() => {})
      .finally(() => {
        setBurning(false);
      });
  };
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
          {canBurn && (
            <Button
              size={"small"}
              variant={"outlined"}
              color={"inherit"}
              disabled={burning}
              onClick={burn}
              sx={{ mt: 1 }}
            >
              Burn momentum
            </Button>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
