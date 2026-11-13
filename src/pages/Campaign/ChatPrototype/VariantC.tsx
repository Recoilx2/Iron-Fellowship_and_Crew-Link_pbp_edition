// PROTOTYPE (#6) Variant C: "Phone first, story feed".
// One column (centred on desktop) with a bottom nav to the other campaign
// screens. Channels are swipeable chips. Speaker is a chip row above the
// text box. A big dice button opens a bottom sheet of roll types. Roll posts
// are full-width "beat" cards with the result as a headline.
import {
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Card,
  Chip,
  Drawer,
  Fab,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ChatIcon from "@mui/icons-material/Forum";
import PersonIcon from "@mui/icons-material/Person";
import TrackIcon from "@mui/icons-material/LinearScale";
import WorldIcon from "@mui/icons-material/Public";
import NotesIcon from "@mui/icons-material/StickyNote2";
import DiceIcon from "@mui/icons-material/Casino";
import ImageIcon from "@mui/icons-material/Image";
import SendIcon from "@mui/icons-material/Send";
import AddIcon from "@mui/icons-material/Add";
import { useEffect, useRef, useState } from "react";
import { ROLL_RESULT, ROLL_TYPE, Roll } from "types/DieRolls.type";
import { getRollTitle } from "functions/rollText";
import { PrototypeChat, Post, RollKind, rollKindLabels, speakerName } from "./usePrototypeChat";
import {
  DraftPreview,
  PlaceholderScreen,
  PostBody,
  PostImages,
  PostMenu,
  PostRoll,
  SpeakerAvatar,
  SpeakerLabel,
  SpeakerOptions,
  speakerKey,
  timeLabel,
  useAttachHandlers,
} from "./shared";

export const name = "Phone first, story feed";

const screens = [
  { key: "Chat", icon: <ChatIcon /> },
  { key: "Character", icon: <PersonIcon /> },
  { key: "Tracks", icon: <TrackIcon /> },
  { key: "World", icon: <WorldIcon /> },
  { key: "My notes", icon: <NotesIcon /> },
];

function headline(roll: Roll) {
  const outcome = (r: ROLL_RESULT) => (r === ROLL_RESULT.HIT ? "Strong hit" : r === ROLL_RESULT.WEAK_HIT ? "Weak hit" : "Miss");
  switch (roll.type) {
    case ROLL_TYPE.STAT:
    case ROLL_TYPE.TRACK_PROGRESS:
      return outcome(roll.result);
    case ROLL_TYPE.ORACLE_TABLE:
    case ROLL_TYPE.CLOCK_PROGRESSION:
      return roll.result;
    case ROLL_TYPE.CUSTOM_DICE:
      return `${roll.total}`;
  }
}

export function VariantC(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const [screen, setScreen] = useState("Chat");
  return (
    <Box sx={{ height: "100%", display: "flex", justifyContent: "center", mx: { xs: -2, sm: 0 } }}>
      <Card variant={"outlined"} sx={{ width: "100%", maxWidth: 760, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {screen === "Chat" ? <ChatScreen chat={chat} /> : <Box sx={{ flexGrow: 1 }}><PlaceholderScreen name={screen} /></Box>}
        <Paper square elevation={3}>
          <BottomNavigation showLabels value={screen} onChange={(_, v) => setScreen(v)}>
            {screens.map((s) => (
              <BottomNavigationAction key={s.key} value={s.key} label={s.key} icon={s.icon} />
            ))}
          </BottomNavigation>
        </Paper>
      </Card>
    </Box>
  );
}

function ChatScreen(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView();
  }, [chat.posts.length, chat.channel.id]);
  return (
    <>
      <Stack direction={"row"} spacing={1} sx={{ p: 1, overflowX: "auto", borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
        {chat.channels
          .filter((c) => !c.archived || c.id === chat.channel.id)
          .map((c) => (
            <Chip
              key={c.id}
              label={`${c.name}${chat.unreadCount(c.id) ? ` · ${chat.unreadCount(c.id)}` : ""}`}
              color={c.id === chat.channel.id ? "primary" : "default"}
              variant={c.id === chat.channel.id ? "filled" : "outlined"}
              icon={<Typography variant={"caption"} sx={{ pl: 1, fontWeight: 700 }}>{c.kind}</Typography>}
              onClick={() => chat.setChannelId(c.id)}
            />
          ))}
        <Chip variant={"outlined"} label={"Archived"} onClick={() => chat.setChannelId("s0")} sx={{ color: "text.secondary" }} />
        {chat.viewAsGM && <Chip icon={<AddIcon />} label={"Channel"} onClick={() => chat.createChannel("New scene", "IC")} />}
      </Stack>
      <Box sx={{ flexGrow: 1, overflowY: "auto", px: { xs: 1, sm: 2 }, py: 1, bgcolor: "background.default" }}>
        {chat.posts.map((p) => (p.roll ? <BeatCard key={p.id} chat={chat} post={p} /> : <StoryPost key={p.id} chat={chat} post={p} />))}
        <div ref={end} />
      </Box>
      {!chat.channel.archived && <Composer chat={chat} />}
    </>
  );
}

function StoryPost(props: { chat: PrototypeChat; post: Post }) {
  const { chat, post } = props;
  const [editing, setEditing] = useState(false);
  const mine = post.authorUid === chat.myUid;
  return (
    <Stack direction={mine ? "row-reverse" : "row"} spacing={1} sx={{ my: 1.5 }} alignItems={"flex-end"}>
      <SpeakerAvatar speaker={post.speaker} authorUid={post.authorUid} size={32} />
      <Box sx={{ maxWidth: "80%" }}>
        <Stack direction={mine ? "row-reverse" : "row"} alignItems={"center"} spacing={0.5}>
          <SpeakerLabel post={post} />
          <PostMenu chat={chat} post={post} onEdit={() => setEditing(true)} />
        </Stack>
        <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: mine ? "primary.main" : "background.paper", color: mine ? "primary.contrastText" : "text.primary", boxShadow: 1 }}>
          <PostBody chat={chat} post={post} editing={editing} setEditing={setEditing} />
          <PostImages images={post.images} />
        </Box>
        <Typography variant={"caption"} color={"text.secondary"} sx={{ display: "block", textAlign: mine ? "right" : "left" }}>
          {timeLabel(post.createdAt)}
        </Typography>
      </Box>
    </Stack>
  );
}

function BeatCard(props: { chat: PrototypeChat; post: Post }) {
  const { chat, post } = props;
  const [editing, setEditing] = useState(false);
  const roll = post.roll as Roll;
  return (
    <Card variant={"outlined"} sx={{ my: 2, borderLeft: 4, borderLeftColor: roll.gmsOnly ? "warning.main" : "primary.main" }}>
      <Stack direction={"row"} spacing={1} alignItems={"center"} sx={{ px: 1.5, pt: 1 }}>
        <SpeakerAvatar speaker={post.speaker} authorUid={post.authorUid} size={28} />
        <SpeakerLabel post={post} />
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant={"caption"} color={"text.secondary"}>
          {timeLabel(post.createdAt)}
        </Typography>
        <PostMenu chat={chat} post={post} onEdit={() => setEditing(true)} />
      </Stack>
      <Box sx={{ px: 1.5, pb: 1.5 }}>
        <Typography variant={"overline"} color={"text.secondary"}>
          {speakerName(post.speaker, post.authorUid)} · {getRollTitle(roll)}
        </Typography>
        <Typography variant={"h4"} sx={{ fontFamily: "serif", mb: 1 }}>
          {headline(roll)}
        </Typography>
        {(post.text || editing) && (
          <Box sx={{ mb: 1 }}>
            <PostBody chat={chat} post={post} editing={editing} setEditing={setEditing} />
          </Box>
        )}
        <PostRoll post={post} compact />
      </Box>
    </Card>
  );
}

function Composer(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const attach = useAttachHandlers(chat);
  const [rollSheet, setRollSheet] = useState(false);
  const options = SpeakerOptions(chat);
  return (
    <Box {...attach.dropProps} sx={{ borderTop: 1, borderColor: "divider", bgcolor: attach.dragging ? "action.hover" : "background.paper", flexShrink: 0 }}>
      {attach.fileInput}
      <Stack direction={"row"} spacing={0.5} sx={{ px: 1, pt: 1, overflowX: "auto" }} alignItems={"center"}>
        <Typography variant={"caption"} color={"text.secondary"} sx={{ whiteSpace: "nowrap" }}>
          Posting as
        </Typography>
        {options.map((o) => (
          <Chip
            key={o.key}
            size={"small"}
            label={o.label}
            color={speakerKey(chat.speaker) === o.key ? "primary" : "default"}
            onClick={() => chat.setSpeaker(o.speaker)}
          />
        ))}
      </Stack>
      <DraftPreview chat={chat} />
      <Stack direction={"row"} spacing={1} alignItems={"flex-end"} sx={{ p: 1 }}>
        <Fab color={"primary"} size={"medium"} onClick={() => setRollSheet(true)} aria-label={"Roll"} sx={{ flexShrink: 0 }}>
          <DiceIcon />
        </Fab>
        <TextField
          multiline
          maxRows={6}
          size={"small"}
          fullWidth
          placeholder={attach.dragging ? "Drop images to attach" : "Write your post…"}
          value={chat.draft.text}
          onChange={(e) => chat.setDraft({ text: e.target.value })}
        />
        <IconButton onClick={attach.openPicker} aria-label={"Attach images"}>
          <ImageIcon />
        </IconButton>
        <IconButton color={"primary"} disabled={!chat.canSend} onClick={chat.send} aria-label={"Send"}>
          <SendIcon />
        </IconButton>
      </Stack>
      <Drawer anchor={"bottom"} open={rollSheet} onClose={() => setRollSheet(false)} PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxWidth: 760, mx: "auto" } }}>
        <Box sx={{ p: 2 }}>
          <Typography variant={"h6"} sx={{ mb: 1 }}>
            Roll as {speakerName(chat.speaker, chat.myUid)}
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 1 }}>
            {(Object.keys(rollKindLabels) as RollKind[]).map((k) => (
              <Card
                key={k}
                variant={"outlined"}
                onClick={() => {
                  chat.attachRoll(k);
                  setRollSheet(false);
                }}
                sx={{ p: 2, textAlign: "center", cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              >
                <DiceIcon />
                <Typography>{rollKindLabels[k]}</Typography>
              </Card>
            ))}
          </Box>
          <Typography variant={"caption"} color={"text.secondary"} sx={{ display: "block", mt: 1 }}>
            In the real app each opens the existing move, stat, progress, oracle or dice picker.
          </Typography>
        </Box>
      </Drawer>
    </Box>
  );
}
