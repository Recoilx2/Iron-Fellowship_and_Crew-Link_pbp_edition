// PROTOTYPE (#6): small pieces reused by every variant. Layout is NOT shared.
import {
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import MoreIcon from "@mui/icons-material/MoreHoriz";
import CloseIcon from "@mui/icons-material/Close";
import { ClipboardEvent, DragEvent, useRef, useState } from "react";
import { RollDisplay } from "components/features/charactersAndCampaigns/RollDisplay";
import { MarkdownRenderer } from "components/shared/MarkdownRenderer";
import {
  PrototypeChat,
  Post,
  Speaker,
  characters,
  people,
  speakerName,
} from "./usePrototypeChat";

export function timeLabel(d: Date) {
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SpeakerAvatar(props: { speaker: Speaker; authorUid: string; size?: number }) {
  const { speaker, authorUid, size = 36 } = props;
  const name = speakerName(speaker, authorUid);
  const colour =
    speaker.kind === "character"
      ? characters[speaker.characterId].colour
      : speaker.kind === "npc"
        ? "#7a3b3b"
        : "#555";
  const portrait = speaker.kind === "character" ? characters[speaker.characterId].portrait : undefined;
  return (
    <Avatar src={portrait} alt={name} sx={{ width: size, height: size, bgcolor: colour, fontSize: size * 0.4 }}>
      {name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)}
    </Avatar>
  );
}

export function SpeakerLabel(props: { post: Post }) {
  const { post } = props;
  const author = people[post.authorUid];
  return (
    <Stack direction={"row"} spacing={0.75} alignItems={"baseline"} flexWrap={"wrap"}>
      <Typography fontWeight={700}>{speakerName(post.speaker, post.authorUid)}</Typography>
      {post.speaker.kind !== "self" && (
        <Typography variant={"caption"} color={"text.secondary"}>
          {author.name}
        </Typography>
      )}
      {author.isGM && <Chip size={"small"} label={"GM"} color={"primary"} sx={{ height: 18 }} />}
      {post.roll?.gmsOnly && (
        <Chip size={"small"} label={"GMs only"} color={"warning"} sx={{ height: 18 }} />
      )}
    </Stack>
  );
}

export function PostMenu(props: { chat: PrototypeChat; post: Post; onEdit: () => void }) {
  const { chat, post, onEdit } = props;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!chat.canEdit(post) && !chat.canDelete(post)) return null;
  return (
    <>
      <IconButton size={"small"} aria-label={"Post actions"} onClick={(e) => setAnchor(e.currentTarget)}>
        <MoreIcon fontSize={"small"} />
      </IconButton>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}>
        {chat.canEdit(post) && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              onEdit();
            }}
          >
            Edit text
          </MenuItem>
        )}
        {chat.canDelete(post) && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              chat.deletePost(post.id);
            }}
          >
            Delete
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

// The text part of a post: markdown, or an inline editor while editing.
export function PostBody(props: {
  chat: PrototypeChat;
  post: Post;
  editing: boolean;
  setEditing: (e: boolean) => void;
}) {
  const { chat, post, editing, setEditing } = props;
  const [value, setValue] = useState(post.text);
  if (post.deleted) {
    return (
      <Typography color={"text.secondary"} fontStyle={"italic"}>
        Post deleted
      </Typography>
    );
  }
  if (editing) {
    return (
      <Stack spacing={1} sx={{ minWidth: 240 }}>
        <TextField multiline size={"small"} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        {post.roll && (
          <Typography variant={"caption"} color={"text.secondary"}>
            The roll itself can&apos;t be edited.
          </Typography>
        )}
        <Stack direction={"row"} spacing={1}>
          <Button
            size={"small"}
            variant={"contained"}
            onClick={() => {
              chat.editPost(post.id, value);
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button size={"small"} color={"inherit"} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </Stack>
      </Stack>
    );
  }
  return (
    <>
      {post.text && <MarkdownRenderer markdown={post.text} inheritColor />}
      {post.editedAt && (
        <Typography variant={"caption"} color={"text.secondary"}>
          (edited)
        </Typography>
      )}
    </>
  );
}

export function PostImages(props: { images: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!props.images.length) return null;
  return (
    <>
      <Stack direction={"row"} spacing={1} flexWrap={"wrap"} useFlexGap>
        {props.images.map((src) => (
          <Box
            key={src}
            component={"img"}
            src={src}
            alt={"Attached image"}
            onClick={() => setOpen(src)}
            sx={{ maxWidth: 260, maxHeight: 180, borderRadius: 1, cursor: "zoom-in", objectFit: "cover" }}
          />
        ))}
      </Stack>
      {open && (
        <Box
          onClick={() => setOpen(null)}
          sx={{
            position: "fixed",
            inset: 0,
            bgcolor: "rgba(0,0,0,0.85)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <Box component={"img"} src={open} alt={"Attached image, enlarged"} sx={{ maxWidth: "92vw", maxHeight: "92vh" }} />
        </Box>
      )}
    </>
  );
}

export function PostRoll(props: { post: Post; compact?: boolean }) {
  const { post } = props;
  if (!post.roll) return null;
  return (
    <RollDisplay
      roll={post.roll}
      isExpanded={!props.compact}
      descriptionPrefix={`${speakerName(post.speaker, post.authorUid)}:`}
    />
  );
}

// What's waiting in the composer before sending: images and a roll.
export function DraftPreview(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const { draft } = chat;
  if (!draft.images.length && !draft.roll) return null;
  return (
    <Stack direction={"row"} spacing={1} sx={{ p: 1, overflowX: "auto" }} alignItems={"flex-start"}>
      {draft.images.map((src) => (
        <Box key={src} sx={{ position: "relative" }}>
          <Box component={"img"} src={src} alt={"Image to attach"} sx={{ height: 72, borderRadius: 1 }} />
          <IconButton
            size={"small"}
            aria-label={"Remove image"}
            onClick={() => chat.removeImage(src)}
            sx={{ position: "absolute", top: 0, right: 0, bgcolor: "rgba(0,0,0,0.6)", color: "#fff" }}
          >
            <CloseIcon fontSize={"inherit"} />
          </IconButton>
        </Box>
      ))}
      {draft.roll && (
        <Box sx={{ position: "relative", maxWidth: 280 }}>
          <RollDisplay roll={draft.roll} isExpanded={false} onDismiss={chat.removeRoll} />
          <Typography variant={"caption"} color={"text.secondary"}>
            Rolled. Add text, then send.
          </Typography>
        </Box>
      )}
    </Stack>
  );
}

// Drag and drop, paste and the file picker all feed the same attach.
export function useAttachHandlers(chat: PrototypeChat) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    openPicker: () => inputRef.current?.click(),
    fileInput: (
      <input
        ref={inputRef}
        type={"file"}
        accept={"image/png,image/jpeg,image/gif,image/webp"}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) chat.attachFiles(e.target.files);
          e.target.value = "";
        }}
      />
    ),
    dropProps: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        setDragging(true);
      },
      onDragLeave: () => setDragging(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        chat.attachFiles(e.dataTransfer.files);
      },
      onPaste: (e: ClipboardEvent) => {
        if (e.clipboardData.files.length) chat.attachFiles(e.clipboardData.files);
      },
    },
  };
}

export function SpeakerOptions(chat: PrototypeChat) {
  return chat.mySpeakers.map((s) => ({
    speaker: s,
    key: s.kind === "character" ? s.characterId : s.kind === "npc" ? `npc:${s.name}` : "self",
    label:
      s.kind === "self"
        ? `${people[chat.myUid].name} (${chat.viewAsGM ? "GM" : "out of character"})`
        : s.kind === "npc"
          ? `${s.name} (NPC)`
          : characters[s.characterId].name,
  }));
}

export function speakerKey(s: Speaker) {
  return s.kind === "character" ? s.characterId : s.kind === "npc" ? `npc:${s.name}` : "self";
}

// Stand-in for the existing campaign screens; the prototype is about chat.
export function PlaceholderScreen(props: { name: string }) {
  return (
    <Box sx={{ p: 3, color: "text.secondary" }}>
      <Typography variant={"h6"}>{props.name}</Typography>
      <Typography>The existing {props.name.toLowerCase()} screen goes here, unchanged.</Typography>
    </Box>
  );
}
