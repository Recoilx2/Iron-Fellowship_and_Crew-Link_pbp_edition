// PROTOTYPE (#6) Variant A: "Game Log, grown up".
// Chat is the first campaign tab. Channels are a dropdown above the feed.
// Posts are Game Log bubbles (yours on the right). Roll buttons sit in a
// labelled row under the text box.
import {
  Box,
  Button,
  Card,
  IconButton,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import ImageIcon from "@mui/icons-material/Image";
import AddIcon from "@mui/icons-material/Add";
import { useEffect, useRef, useState } from "react";
import { StyledTab, StyledTabs } from "components/shared/StyledTabs";
import {
  PrototypeChat,
  Post,
  RollKind,
  rollKindLabels,
} from "./usePrototypeChat";
import {
  DraftPreview,
  PlaceholderScreen,
  PostBody,
  PostImages,
  PostMenu,
  PostRoll,
  SpeakerLabel,
  SpeakerOptions,
  speakerKey,
  timeLabel,
  useAttachHandlers,
} from "./shared";

export const name = "Game Log, grown up";

const tabs = ["Chat", "Characters", "Tracks", "Notes", "World"];

export function VariantA(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const [tab, setTab] = useState("Chat");
  return (
    <Card
      variant={"outlined"}
      sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", mx: { xs: -2, sm: 0 } }}
    >
      <StyledTabs value={tab} onChange={(_, v) => setTab(v)} variant={"scrollable"}>
        {tabs.map((t) => (
          <StyledTab key={t} label={t} value={t} />
        ))}
      </StyledTabs>
      {tab === "Chat" ? <ChatPane chat={chat} /> : <PlaceholderScreen name={tab} />}
    </Card>
  );
}

function ChatPane(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const open = chat.channels.filter((c) => !c.archived);
  const archived = chat.channels.filter((c) => c.archived);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView();
  }, [chat.posts.length, chat.channel.id]);

  return (
    <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Stack direction={"row"} alignItems={"center"} spacing={1} sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
        <Select
          size={"small"}
          value={chat.channel.id}
          onChange={(e) => chat.setChannelId(e.target.value)}
          sx={{ minWidth: 220 }}
          renderValue={() => `${chat.channel.kind} · ${chat.channel.name}`}
        >
          {open.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.kind} · {c.name}
              {chat.unreadCount(c.id) > 0 && (
                <Typography component={"span"} color={"primary"} sx={{ ml: 1, fontWeight: 700 }}>
                  {chat.unreadCount(c.id)} new
                </Typography>
              )}
            </MenuItem>
          ))}
          {archived.length > 0 && <ListSubheader>Archived</ListSubheader>}
          {archived.map((c) => (
            <MenuItem key={c.id} value={c.id} sx={{ color: "text.secondary" }}>
              {c.kind} · {c.name}
            </MenuItem>
          ))}
        </Select>
        {chat.viewAsGM && (
          <Button size={"small"} startIcon={<AddIcon />} onClick={() => chat.createChannel("New scene", "IC")}>
            Channel
          </Button>
        )}
      </Stack>

      <Box sx={{ flexGrow: 1, overflowY: "auto", bgcolor: "background.default" }}>
        <Typography variant={"caption"} color={"text.secondary"} sx={{ display: "block", textAlign: "center", pt: 1 }}>
          Scroll up for older posts
        </Typography>
        {chat.posts.map((p) => (
          <Bubble key={p.id} chat={chat} post={p} />
        ))}
        <div ref={end} />
      </Box>

      {chat.channel.archived ? (
        <Typography sx={{ p: 2 }} color={"text.secondary"}>
          This channel is archived.
        </Typography>
      ) : (
        <Composer chat={chat} />
      )}
    </Box>
  );
}

function Bubble(props: { chat: PrototypeChat; post: Post }) {
  const { chat, post } = props;
  const [editing, setEditing] = useState(false);
  const mine = post.authorUid === chat.myUid;
  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
      <Stack direction={"row"} alignItems={"center"} spacing={0.5}>
        <SpeakerLabel post={post} />
        <PostMenu chat={chat} post={post} onEdit={() => setEditing(true)} />
      </Stack>
      <Stack
        spacing={1}
        sx={{
          mt: 0.5,
          maxWidth: { xs: "90%", md: 520 },
          p: post.text || editing || post.deleted ? 1.5 : 0,
          borderRadius: 2,
          bgcolor: post.text || editing || post.deleted ? (mine ? "primary.light" : "background.paper") : "transparent",
          color: mine && post.text ? "primary.contrastText" : "text.primary",
          border: post.text && !mine ? 1 : 0,
          borderColor: "divider",
        }}
      >
        <PostBody chat={chat} post={post} editing={editing} setEditing={setEditing} />
        <PostImages images={post.images} />
        <PostRoll post={post} />
      </Stack>
      <Typography color={"text.secondary"} variant={"caption"}>
        {timeLabel(post.createdAt)}
      </Typography>
    </Box>
  );
}

function Composer(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const attach = useAttachHandlers(chat);
  const options = SpeakerOptions(chat);
  return (
    <Box
      {...attach.dropProps}
      sx={{ borderTop: 1, borderColor: "divider", p: 1, bgcolor: attach.dragging ? "action.hover" : "background.paper" }}
    >
      {attach.fileInput}
      <DraftPreview chat={chat} />
      <Stack direction={"row"} spacing={1} alignItems={"flex-end"}>
        <Select
          size={"small"}
          value={speakerKey(chat.speaker)}
          onChange={(e) => {
            const o = options.find((x) => x.key === e.target.value);
            if (o) chat.setSpeaker(o.speaker);
          }}
          sx={{ minWidth: { xs: 110, sm: 170 } }}
        >
          {options.map((o) => (
            <MenuItem key={o.key} value={o.key}>
              {o.label}
            </MenuItem>
          ))}
        </Select>
        <TextField
          multiline
          maxRows={6}
          size={"small"}
          fullWidth
          placeholder={attach.dragging ? "Drop images to attach" : `Post in ${chat.channel.name}`}
          value={chat.draft.text}
          onChange={(e) => chat.setDraft({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              chat.send();
            }
          }}
        />
        <IconButton color={"primary"} disabled={!chat.canSend} onClick={chat.send} aria-label={"Send"}>
          <SendIcon />
        </IconButton>
      </Stack>
      <Stack direction={"row"} spacing={0.5} sx={{ mt: 1, overflowX: "auto" }} alignItems={"center"}>
        <IconButton size={"small"} onClick={attach.openPicker} aria-label={"Attach images"}>
          <ImageIcon fontSize={"small"} />
        </IconButton>
        <Typography variant={"caption"} color={"text.secondary"} sx={{ pr: 0.5 }}>
          Roll:
        </Typography>
        {(Object.keys(rollKindLabels) as RollKind[]).map((k) => (
          <Button key={k} size={"small"} variant={"outlined"} color={"inherit"} onClick={() => chat.attachRoll(k)}>
            {rollKindLabels[k]}
          </Button>
        ))}
      </Stack>
    </Box>
  );
}
