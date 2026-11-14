import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
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
import ImageIcon from "@mui/icons-material/Image";
import CloseIcon from "@mui/icons-material/Close";
import VisibleIcon from "@mui/icons-material/Visibility";
import HiddenIcon from "@mui/icons-material/VisibilityOff";
import { useStore } from "stores/store";
import { useHide3dDice } from "hooks/useHide3dDice";
import type { ChannelKind } from "api-calls/chat/_chat.type";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import { createPost } from "api-calls/chat/createPost";
import { validateChatImageFile } from "api-calls/chat/chatImageLimits";
import { mintErrorReference } from "functions/errorReference";
import {
  removeChatImage,
  uploadChatImage,
} from "api-calls/chat/chatImages";
import { rollDice } from "stores/appState/rollers/rollDice";
import { rollDie } from "stores/appState/rollers/rollDie";
import type { Roll } from "types/DieRolls.type";
import { ROLL_TYPE } from "types/DieRolls.type";
import { RollDisplay } from "components/features/charactersAndCampaigns/RollDisplay";
import { burnMomentumResult, isMomentumBurnUseful } from "functions/momentumBurn";
import { useSnackbar } from "providers/SnackbarProvider";
import type { ChatRollContext, DiceRoller } from "functions/chatRolls";
import { ChatRollPicker, type ChatRollKind } from "./ChatRollPickers";
import { defaultChatSpeaker } from "functions/chatSpeaker";

interface PendingAttachment {
  key: string;
  name: string;
  previewUrl: string;
  /** Storage path once the attach-time upload lands; null while flying. */
  path: string | null;
  uploading: boolean;
}

function previewUrlFor(file: File): string {
  if (typeof URL.createObjectURL === "function") {
    try {
      return URL.createObjectURL(file);
    } catch {
      // jsdom and other file-less environments fall through below.
    }
  }
  return `preview:${file.name}`;
}

function revokePreviewUrl(url: string): void {
  if (
    url.startsWith("blob:") &&
    typeof URL.revokeObjectURL === "function"
  ) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Revoking is best-effort: a stuck blob URL never breaks posting.
    }
  }
}

/**
 * The channel composer (spec #9, prototype variant D): a "Posting as ..."
 * line, image previews, the text box with send, the image button, and the
 * roll buttons below it. Players have no speaker picker: the channel kind
 * picks the speaker, so switching channels switches voices. GMs alone get a
 * simple picker over the campaign world's NPC list, and the voice resets
 * whenever the channel switches. The text box keeps its unsent draft per
 * channel for the session.
 *
 * Images attach by dropping them anywhere on the composer, pasting them, or
 * picking files: each uploads as it attaches so sending is instant, shows
 * a preview above the text box, and removing it before posting deletes its
 * upload. Unsent uploads are discarded when the composer closes.
 *
 * Rolling a move, stat, oracle or custom dice attaches the result to the
 * draft, so the player adds text and sends both to the current channel as
 * the current speaker. Players roll from their campaign character; GMs roll
 * Ask the Oracle, Oracles and Dice, and their eye toggle posts GM-only.
 */
export function ChatComposer(props: {
  channel: ChannelWithId;
  campaignId: string;
}) {
  const { channel, campaignId } = props;
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
  const worldId = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaign?.worldId
  );
  const npcMap = useStore(
    (store) => store.worlds.currentWorld.currentWorldNPCs.npcMap ?? {}
  );
  const draft = useStore((store) => store.chat.drafts[channelId] ?? "");
  const setDraft = useStore((store) => store.chat.setDraft);
  const pendingRoll = useStore(
    (store) => store.chat.pendingRolls[channelId]
  );
  const setPendingRoll = useStore((store) => store.chat.setPendingRoll);

  const [sending, setSending] = useState(false);
  const [npcSpeakerId, setNpcSpeakerId] = useState<string | null>(null);
  useEffect(() => {
    setNpcSpeakerId(null);
  }, [channelId]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | undefined>(
    undefined
  );
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The post id is minted with the first attachment so attach-time uploads
  // land under the post they will belong to.
  const pendingPostIdRef = useRef<string | undefined>(undefined);
  const cancelledKeysRef = useRef<Set<string>>(new Set());
  // Paths handed to a post stay behind when the composer closes; anything
  // else uploaded is an unsent orphan and goes with it.
  const sentPathsRef = useRef<Set<string>>(new Set());
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  attachmentsRef.current = attachments;

  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        revokePreviewUrl(attachment.previewUrl);
        if (attachment.path && !sentPathsRef.current.has(attachment.path)) {
          removeChatImage(attachment.path).catch(() => {});
        }
      }
    },
    []
  );
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
  const isGM = gmIds.includes(uid);
  const npcs = Object.entries(npcMap).sort(([, a], [, b]) =>
    a.name.localeCompare(b.name)
  );
  // The picker is a GM tool over the campaign's world: players never see
  // it, and neither do GMs with no world or no NPCs to voice.
  const npcPicker = isGM && worldId != null && npcs.length > 0;
  const pickedNpc =
    npcPicker && npcSpeakerId ? (npcMap[npcSpeakerId] ?? undefined) : undefined;
  const speaker =
    pickedNpc && npcSpeakerId
      ? { characterId: null, npcId: npcSpeakerId }
      : defaultChatSpeaker(channelKind, myEntry?.[0]);
  const speakerCharacter = speaker.characterId
    ? characterMap[speaker.characterId]
    : undefined;
  const speakerName =
    pickedNpc?.name ?? speakerCharacter?.name ?? displayName ?? "Someone";

  const uploading = attachments.some((attachment) => attachment.uploading);
  const canSend =
    (draft.trim().length > 0 || attachments.length > 0 || !!pendingRoll) &&
    !sending &&
    !uploading;

  const pendingPostId = (): string => {
    if (!pendingPostIdRef.current) {
      pendingPostIdRef.current = crypto.randomUUID();
    }
    return pendingPostIdRef.current;
  };

  const attachFiles = (files: File[]) => {
    if (files.length === 0 || !campaignId) {
      return;
    }
    setAttachError(undefined);
    const postId = pendingPostId();
    for (const file of files) {
      const refusal = validateChatImageFile(file);
      if (refusal) {
        setAttachError(refusal);
        continue;
      }
      const key = crypto.randomUUID();
      const previewUrl = previewUrlFor(file);
      setAttachments((current) => [
        ...current,
        { key, name: file.name, previewUrl, path: null, uploading: true },
      ]);
      uploadChatImage(campaignId, postId, file).then(
        (path) => {
          if (cancelledKeysRef.current.has(key)) {
            cancelledKeysRef.current.delete(key);
            removeChatImage(path).catch(() => {});
            return;
          }
          setAttachments((current) =>
            current.map((attachment) =>
              attachment.key === key
                ? { ...attachment, path, uploading: false }
                : attachment
            )
          );
        },
        () => {
          cancelledKeysRef.current.delete(key);
          revokePreviewUrl(previewUrl);
          setAttachments((current) =>
            current.filter((attachment) => attachment.key !== key)
          );
          setAttachError(
            `Could not attach that image. Try again. (ref: ${mintErrorReference()})`
          );
        }
      );
    }
  };

  const removeAttachment = (key: string) => {
    const attachment = attachmentsRef.current.find((item) => item.key === key);
    if (!attachment) {
      return;
    }
    if (attachment.uploading) {
      cancelledKeysRef.current.add(key);
    } else if (attachment.path) {
      removeChatImage(attachment.path).catch(() => {});
    }
    revokePreviewUrl(attachment.previewUrl);
    setAttachments((current) =>
      current.filter((item) => item.key !== key)
    );
  };
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

  const attachRoll = (roll: Roll) => {
    setPendingRoll(channelId, {
      ...roll,
      characterId: speaker.characterId,
      uid,
      gmsOnly: isGM && !shareRolls,
    });
    setPicker(null);
  };

  const { success } = useSnackbar();
  // Burning before sending: the player marks the waiting action roll to
  // burn, stamping the draft with the recalculated outcome. Nothing is
  // spent yet: sending posts the burned roll, and the database spends the
  // momentum in the same transaction. Discarding the draft or a failed
  // send loses nothing. Only for their own character, at most once, when
  // the burn would change the outcome. GMs voicing an NPC or themselves
  // have no momentum to burn.
  const canBurnComposer =
    pendingRoll?.type === ROLL_TYPE.STAT &&
    pendingRoll.momentumBurned === undefined &&
    speaker.characterId != null &&
    myCharacter != null &&
    isMomentumBurnUseful(pendingRoll, myCharacter.momentum);

  const burnComposerRoll = () => {
    if (!canBurnComposer || !pendingRoll || pendingRoll.type !== ROLL_TYPE.STAT) {
      return;
    }
    const momentum = myCharacter?.momentum ?? 0;
    const newResult = burnMomentumResult(pendingRoll, momentum);
    // Stamped, not spent: the momentum leaves only when the post sends,
    // in the same transaction as the burned roll.
    setPendingRoll(channelId, {
      ...pendingRoll,
      momentumBurned: momentum,
      result: newResult,
    });
    success("Momentum will burn when this post sends.");
  };

  const send = () => {
    if (!canSend) {
      return;
    }
    const paths = attachments
      .map((attachment) => attachment.path)
      .filter((path): path is string => path !== null);
    for (const path of paths) {
      sentPathsRef.current.add(path);
    }
    setSending(true);
    setSendError(undefined);
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
      postId: pendingPostIdRef.current,
      text: draft,
      speakerCharacterId: speaker.characterId,
      speakerNpcId: speaker.npcId,
      imagePaths: paths,
      roll,
      gmsOnly: roll?.gmsOnly,
    })
      .then(() => {
        setDraft(channelId, "");
        setPendingRoll(channelId, null);
        for (const attachment of attachmentsRef.current) {
          revokePreviewUrl(attachment.previewUrl);
        }
        setAttachments([]);
        pendingPostIdRef.current = undefined;
        setAttachError(undefined);
      })
      .catch(() => {
        for (const path of paths) {
          sentPathsRef.current.delete(path);
          // The post never landed, so its staged uploads are orphans:
          // remove them best-effort so a failed send leaves no files behind.
          removeChatImage(path).catch(() => {});
        }
        // The draft stays put with its burned stamp, and no momentum was
        // spent: the user sees a generic error with a reference and can
        // retry the same send.
        setSendError(
          `Could not send that post. Try again. (ref: ${mintErrorReference()})`
        );
      })
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <Box
      sx={{ borderTop: 1, borderColor: "divider", p: 1 }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault();
          attachFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <Stack direction={"row"} spacing={1} alignItems={"center"} sx={{ px: 0.5, pb: 0.5 }}>
        <Typography variant={"body2"} color={"text.secondary"}>
          Posting as <b>{speakerName}</b>
          {isGM ? " (GM)" : ""}
          {channelKind === "OOC" && myCharacter
            ? ` · ${myCharacter.name} (out of character)`
            : ""}
        </Typography>
      </Stack>
      {npcPicker && (
        <Box sx={{ px: 0.5, pb: 0.5, maxWidth: 280 }}>
          <TextField
            select
            fullWidth
            size={"small"}
            label={"Voice"}
            value={npcSpeakerId ?? ""}
            onChange={(e) => setNpcSpeakerId(e.target.value || null)}
            SelectProps={{ native: true }}
            inputProps={{ "aria-label": "Posting as" }}
          >
            <option value={""}>Yourself</option>
            {npcs.map(([id, npc]) => (
              <option key={id} value={id}>
                {npc.name}
              </option>
            ))}
          </TextField>
        </Box>
      )}
      {attachments.length > 0 && (
        <Stack
          direction={"row"}
          spacing={1}
          sx={{ px: 0.5, pb: 1, overflowX: "auto" }}
          aria-label={"Attached images"}
        >
          {attachments.map((attachment) => (
            <Box key={attachment.key} sx={{ position: "relative", flexShrink: 0 }}>
              <Box
                component={"img"}
                src={attachment.previewUrl}
                alt={attachment.name}
                sx={{
                  width: 72,
                  height: 72,
                  objectFit: "cover",
                  borderRadius: 1,
                  display: "block",
                  opacity: attachment.uploading ? 0.5 : 1,
                }}
              />
              <IconButton
                size={"small"}
                aria-label={`Remove ${attachment.name}`}
                onClick={() => removeAttachment(attachment.key)}
                sx={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bgcolor: "background.paper",
                }}
              >
                <CloseIcon fontSize={"small"} />
              </IconButton>
            </Box>
          ))}
        </Stack>
      )}
      {attachError && (
        <Alert
          severity={"error"}
          onClose={() => setAttachError(undefined)}
          sx={{ mb: 1 }}
        >
          {attachError}
        </Alert>
      )}
      {sendError && (
        <Alert
          severity={"error"}
          onClose={() => setSendError(undefined)}
          sx={{ mb: 1 }}
        >
          {sendError}
        </Alert>
      )}
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
          {canBurnComposer && (
            <Button
              size={"small"}
              variant={"outlined"}
              color={"inherit"}
              onClick={burnComposerRoll}
              sx={{ mt: 0.5 }}
            >
              Burn momentum
            </Button>
          )}
        </Box>
      )}
      <Stack direction={"row"} spacing={1} alignItems={"flex-end"}>
        <IconButton
          color={"inherit"}
          aria-label={"Attach images"}
          disabled={!campaignId || sending}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageIcon />
        </IconButton>
        <input
          ref={fileInputRef}
          type={"file"}
          accept={"image/png,image/jpeg,image/gif,image/webp"}
          multiple
          hidden
          aria-label={"Attach images"}
          onChange={(e) => {
            attachFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <TextField
          multiline
          maxRows={8}
          size={"small"}
          fullWidth
          placeholder={`Post in # ${channel.name}`}
          inputProps={{ "aria-label": `Post in # ${channel.name}` }}
          value={draft}
          onChange={(e) => setDraft(channelId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            const pasted = Array.from(
              e.clipboardData?.files ?? []
            ).filter((file) => file.type.startsWith("image/"));
            if (pasted.length > 0) {
              e.preventDefault();
              attachFiles(pasted);
            }
          }}
          sx={
            dragging
              ? { "& .MuiOutlinedInput-root": { borderColor: "primary.main" } }
              : undefined
          }
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
        conditionMeters={myCharacter?.conditionMeters ?? {}}
        characterName={myCharacter?.name ?? null}
        context={context}
        roller={roller}
        onClose={() => setPicker(null)}
        onRoll={attachRoll}
      />
    </Box>
  );
}
