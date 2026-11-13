import { useMemo, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import VisibleIcon from "@mui/icons-material/Visibility";
import HiddenIcon from "@mui/icons-material/VisibilityOff";
import { useStore } from "stores/store";
import { useHide3dDice } from "hooks/useHide3dDice";
import type { ChannelKind } from "api-calls/chat/_chat.type";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import { createPost } from "api-calls/chat/createPost";
import { rollDice } from "stores/appState/rollers/rollDice";
import { rollDie } from "stores/appState/rollers/rollDie";
import type { Roll } from "types/DieRolls.type";
import { RollDisplay } from "components/features/charactersAndCampaigns/RollDisplay";
import type { ChatRollContext, DiceRoller } from "./chatRolls";
import { ChatRollPicker, type ChatRollKind } from "./ChatRollPickers";
import { defaultChatSpeaker } from "./chatSpeaker";

/**
 * The channel composer (spec #9, prototype variant D): a "Posting as ..."
 * line, the text box with send, and the roll buttons below it. Rolling a
 * move, stat, oracle or custom dice attaches the result to the draft, so
 * the player adds text and sends both to the current channel as the
 * current speaker. Players roll from their campaign character; GMs roll
 * Ask the Oracle, Oracles and Dice, and their eye toggle posts GM-only.
 * The text box keeps its unsent draft per channel for the session.
 */
export function ChatComposer(props: { channel: ChannelWithId }) {
  const { channel } = props;
  const channelId = channel.id;
  const channelKind: ChannelKind = channel.kind;

  const uid = useStore((store) => store.auth.uid);
  const displayName = useStore(
    (store) => store.auth.user?.displayName ?? ""
  );
  const characterMap = useStore(
    (store) =>
      store.campaigns.currentCampaign.characters.characterMap ?? {}
  );
  const gmIds = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaign?.gmIds ?? []
  );
  const draft = useStore((store) => store.chat.drafts[channelId] ?? "");
  const setDraft = useStore((store) => store.chat.setDraft);
  const pendingRoll = useStore(
    (store) => store.chat.pendingRolls[channelId]
  );
  const setPendingRoll = useStore((store) => store.chat.setPendingRoll);

  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState<ChatRollKind | null>(null);
  // The GM's eye toggle: players see the GM's rolls while it is open.
  // Following the prototype, it starts open.
  const [shareRolls, setShareRolls] = useState(true);

  const theme = useTheme();
  const hide3dDice = useHide3dDice();

  const myEntry = Object.entries(characterMap).find(
    ([, character]) => character.uid === uid
  );
  const myCharacter = myEntry?.[1];
  const speaker = defaultChatSpeaker(channelKind, myEntry?.[0]);
  const speakerCharacter = speaker.characterId
    ? characterMap[speaker.characterId]
    : undefined;
  const speakerName = speakerCharacter?.name || displayName || "Someone";
  const isGM = gmIds.includes(uid);

  // Moves and stats need the speaker's character; in guided play the GM
  // has none, so they roll Ask the Oracle, Oracles and Dice.
  const canRollFromCharacter = !!myCharacter;

  const roller = useMemo<DiceRoller>(
    () => ({
      rollGroups: (groups) =>
        rollDice(
          groups.map((group) => ({
            qty: group.qty,
            sides: group.sides,
            themeColor: theme.palette.primary.main,
          })),
          !hide3dDice
        ),
      rollExpression: (expression) => rollDie(expression, theme, hide3dDice),
    }),
    [theme, hide3dDice]
  );

  const context: ChatRollContext = {
    characterId: speaker.characterId,
    uid,
    gmsOnly: isGM && !shareRolls,
    momentum: myCharacter?.momentum,
  };

  const canSend = (draft.trim().length > 0 || !!pendingRoll) && !sending;

  const attachRoll = (roll: Roll) => {
    setPendingRoll(channelId, {
      ...roll,
      characterId: speaker.characterId,
      uid,
      gmsOnly: isGM && !shareRolls,
    });
    setPicker(null);
  };

  const send = () => {
    if (!canSend) {
      return;
    }
    setSending(true);
    const roll = pendingRoll
      ? {
          ...pendingRoll,
          characterId: speaker.characterId,
          uid,
          gmsOnly: isGM && !shareRolls,
        }
      : null;
    createPost({
      channelId,
      text: draft,
      speakerCharacterId: speaker.characterId,
      roll,
      gmsOnly: roll?.gmsOnly,
    })
      .then(() => {
        setDraft(channelId, "");
        setPendingRoll(channelId, null);
      })
      .catch(() => {})
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", p: 1 }}>
      <Stack direction={"row"} spacing={1} alignItems={"center"} sx={{ px: 0.5, pb: 0.5 }}>
        <Typography variant={"body2"} color={"text.secondary"}>
          Posting as <b>{speakerName}</b>
          {isGM ? " (GM)" : ""}
          {channelKind === "OOC" && myCharacter
            ? ` · ${myCharacter.name} (out of character)`
            : ""}
        </Typography>
      </Stack>
      {pendingRoll && (
        <Box sx={{ position: "relative", maxWidth: 320, px: 0.5, pb: 0.5 }}>
          <RollDisplay
            roll={pendingRoll}
            isExpanded={false}
            onDismiss={() => setPendingRoll(channelId, null)}
          />
          <Typography variant={"caption"} color={"text.secondary"}>
            Rolled. Add text, then send.
          </Typography>
        </Box>
      )}
      <Stack direction={"row"} spacing={1} alignItems={"flex-end"}>
        <TextField
          multiline
          maxRows={8}
          size={"small"}
          fullWidth
          placeholder={`Message # ${channel.name}`}
          inputProps={{ "aria-label": `Message # ${channel.name}` }}
          value={draft}
          onChange={(e) => setDraft(channelId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <IconButton color={"primary"} disabled={!canSend} onClick={send} aria-label={"Send"}>
          <SendIcon />
        </IconButton>
      </Stack>
      <Stack direction={"row"} spacing={0.5} sx={{ mt: 1, overflowX: "auto" }} alignItems={"center"}>
        {isGM && (
          <Tooltip
            title={
              shareRolls
                ? "Players see your rolls"
                : "Your rolls are hidden from players"
            }
          >
            <IconButton
              size={"small"}
              onClick={() => setShareRolls((value) => !value)}
              aria-label={
                shareRolls
                  ? "Hide my rolls from players"
                  : "Show my rolls to players"
              }
              aria-pressed={shareRolls}
              color={shareRolls ? "default" : "warning"}
            >
              {shareRolls ? (
                <VisibleIcon fontSize={"small"} />
              ) : (
                <HiddenIcon fontSize={"small"} />
              )}
            </IconButton>
          </Tooltip>
        )}
        <Typography variant={"caption"} color={"text.secondary"} sx={{ pr: 0.5 }}>
          Roll:
        </Typography>
        {canRollFromCharacter && (
          <Button
            size={"small"}
            variant={"outlined"}
            color={"inherit"}
            onClick={() => setPicker("move")}
            sx={{ flexShrink: 0 }}
          >
            Move
          </Button>
        )}
        {canRollFromCharacter && (
          <Button
            size={"small"}
            variant={"outlined"}
            color={"inherit"}
            onClick={() => setPicker("stat")}
            sx={{ flexShrink: 0 }}
          >
            Stat
          </Button>
        )}
        <Button
          size={"small"}
          variant={"outlined"}
          color={"inherit"}
          onClick={() => setPicker("ask")}
          sx={{ flexShrink: 0 }}
        >
          Ask the Oracle
        </Button>
        <Button
          size={"small"}
          variant={"outlined"}
          color={"inherit"}
          onClick={() => setPicker("oracle")}
          sx={{ flexShrink: 0 }}
        >
          Oracles
        </Button>
        <Button
          size={"small"}
          variant={"outlined"}
          color={"inherit"}
          onClick={() => setPicker("dice")}
          sx={{ flexShrink: 0 }}
        >
          Dice
        </Button>
      </Stack>
      <ChatRollPicker
        kind={picker}
        stats={myCharacter?.stats ?? {}}
        characterName={myCharacter?.name ?? null}
        context={context}
        roller={roller}
        onClose={() => setPicker(null)}
        onRoll={attachRoll}
      />
    </Box>
  );
}
