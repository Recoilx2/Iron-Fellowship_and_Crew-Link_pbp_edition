import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import ImageIcon from "@mui/icons-material/Image";
import CloseIcon from "@mui/icons-material/Close";
import { useStore } from "stores/store";
import type { ChannelKind } from "api-calls/chat/_chat.type";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import { createPost } from "api-calls/chat/createPost";
import { validateChatImageFile } from "api-calls/chat/chatImageLimits";
import {
  removeChatImage,
  uploadChatImage,
} from "api-calls/chat/chatImages";
import { defaultChatSpeaker } from "./chatSpeaker";

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
 * line, image previews, the text box with send, and the image button that
 * starts the roll button row (rolls join it in a later ticket). Players
 * have no speaker picker: the channel kind picks the speaker, so switching
 * channels switches voices. GMs alone get a simple picker over the campaign
 * world's NPC list, and the voice resets whenever the channel switches. The
 * text box keeps its unsent draft per channel for the session.
 *
 * Images attach by dropping them anywhere on the composer, pasting them, or
 * picking files: each uploads as it attaches so sending is instant, shows
 * a preview above the text box, and removing it before posting deletes its
 * upload. Unsent uploads are discarded when the composer closes.
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

  const [sending, setSending] = useState(false);
  const [npcSpeakerId, setNpcSpeakerId] = useState<string | null>(null);
  useEffect(() => {
    setNpcSpeakerId(null);
  }, [channelId]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | undefined>(
    undefined
  );
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
    (draft.trim().length > 0 || attachments.length > 0) &&
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
          setAttachError("Could not attach that image. Try again.");
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
    createPost({
      channelId,
      postId: pendingPostIdRef.current,
      text: draft,
      speakerCharacterId: speaker.characterId,
      speakerNpcId: speaker.npcId,
      imagePaths: paths,
    })
      .then(() => {
        setDraft(channelId, "");
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
        }
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
    </Box>
  );
}
