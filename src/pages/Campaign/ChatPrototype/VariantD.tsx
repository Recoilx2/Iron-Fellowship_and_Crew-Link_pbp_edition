// PROTOTYPE (#6) Variant D: the human's pick so far, "B's panes with A's
// composer". Desktop: channels + people | feed | campaign screens. Phone:
// C's bottom tabs and channel chips. Rolls are dark one-liners that expand.
// No speaker picker for players: IC = your campaign character, OOC = you.
// GMs make private channels, move people in and out; anyone can DM.
import {
  AvatarGroup,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  ListSubheader,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/AddCircleOutline";
import SendIcon from "@mui/icons-material/Send";
import ImageIcon from "@mui/icons-material/Image";
import LockIcon from "@mui/icons-material/Lock";
import PeopleIcon from "@mui/icons-material/People";
import DiceIcon from "@mui/icons-material/Casino";
import ChatIcon from "@mui/icons-material/Forum";
import PersonIcon from "@mui/icons-material/Person";
import TrackIcon from "@mui/icons-material/LinearScale";
import WorldIcon from "@mui/icons-material/Public";
import NotesIcon from "@mui/icons-material/StickyNote2";
import { useEffect, useRef, useState } from "react";
import { StyledTab, StyledTabs } from "components/shared/StyledTabs";
import { getRollTitle } from "functions/rollText";
import {
  Channel,
  PrototypeChat,
  Post,
  RollKind,
  Speaker,
  characters,
  people,
  rollKindLabels,
  speakerName,
} from "./usePrototypeChat";
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
import { rollSummary } from "./VariantB";
import { RollPicker } from "./RollPicker";

export const name = "Pick so far: B panes + A composer";

const characterOf = (uid: string) => Object.values(characters).find((c) => c.uid === uid);
const personSpeaker = (uid: string): Speaker => {
  const c = characterOf(uid);
  return c ? { kind: "character", characterId: c.id } : { kind: "self" };
};

export function VariantD(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up("md"));
  const wide = useMediaQuery(theme.breakpoints.up("lg"));
  return desktop ? (
    <Card variant={"outlined"} sx={{ height: "100%", display: "flex", overflow: "hidden" }}>
      <Box sx={{ width: 250, flexShrink: 0, borderRight: 1, borderColor: "divider", overflowY: "auto" }}>
        <Sidebar chat={chat} />
      </Box>
      <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <ChannelHeader chat={chat} />
        <Feed chat={chat} />
        {!chat.channel.archived && <Composer chat={chat} />}
      </Box>
      {wide && (
        <Box sx={{ width: 360, flexShrink: 0, borderLeft: 1, borderColor: "divider", overflowY: "auto" }}>
          <CampaignScreens />
        </Box>
      )}
    </Card>
  ) : (
    <Phone chat={chat} />
  );
}

function channelLabel(c: Channel) {
  return c.dm ? `@ ${c.name}` : `# ${c.name}`;
}

function Sidebar(props: { chat: PrototypeChat; onPick?: () => void }) {
  const { chat, onPick } = props;
  const [showArchived, setShowArchived] = useState(false);
  const [newPrivate, setNewPrivate] = useState(false);
  const pick = (id: string) => {
    chat.setChannelId(id);
    onPick?.();
  };
  const item = (c: Channel) => (
    <ListItemButton key={c.id} selected={c.id === chat.channel.id} onClick={() => pick(c.id)} sx={{ color: c.archived ? "text.secondary" : undefined }}>
      {c.members && !c.dm && <LockIcon sx={{ fontSize: 14, mr: 0.75, opacity: 0.6 }} />}
      <ListItemText primary={channelLabel(c)} primaryTypographyProps={{ noWrap: true, fontWeight: chat.unreadCount(c.id) ? 700 : 400 }} />
      {chat.unreadCount(c.id) > 0 && (
        <Typography variant={"caption"} sx={{ bgcolor: "primary.main", color: "primary.contrastText", borderRadius: 4, px: 0.75 }}>
          {chat.unreadCount(c.id)}
        </Typography>
      )}
    </ListItemButton>
  );
  const open = chat.channels.filter((c) => !c.archived);
  const header = (label: string, onAdd?: () => void) => (
    <ListSubheader sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", lineHeight: "36px" }}>
      {label}
      {onAdd && (
        <IconButton size={"small"} aria-label={`New ${label}`} onClick={onAdd}>
          <AddIcon fontSize={"small"} />
        </IconButton>
      )}
    </ListSubheader>
  );
  return (
    <List dense>
      {header("In character", chat.viewAsGM ? () => chat.createChannel("New scene", "IC") : undefined)}
      {open.filter((c) => c.kind === "IC" && !c.members).map(item)}
      {header("Out of character", chat.viewAsGM ? () => chat.createChannel("New table talk", "OOC") : undefined)}
      {open.filter((c) => c.kind === "OOC" && !c.members).map(item)}
      {(chat.viewAsGM || open.some((c) => c.members && !c.dm)) && header("Private", chat.viewAsGM ? () => setNewPrivate(true) : undefined)}
      {open.filter((c) => c.members && !c.dm).map(item)}
      {open.some((c) => c.dm) && header("Direct messages")}
      {open.filter((c) => c.dm).map(item)}
      <ListItemButton onClick={() => setShowArchived((s) => !s)}>
        <ListItemText secondary={showArchived ? "Hide archived" : "Show archived"} />
      </ListItemButton>
      <Collapse in={showArchived}>{chat.channels.filter((c) => c.archived).map(item)}</Collapse>

      {header("People")}
      {Object.values(people).map((p) => {
        const c = characterOf(p.uid);
        return (
          <ListItemButton key={p.uid} disabled={p.uid === chat.myUid} onClick={() => { chat.openDM(p.uid); onPick?.(); }}>
            <ListItemAvatar sx={{ minWidth: 40 }}>
              <SpeakerAvatar speaker={personSpeaker(p.uid)} authorUid={p.uid} size={28} />
            </ListItemAvatar>
            <ListItemText
              primary={c ? c.name : p.name}
              secondary={p.uid === chat.myUid ? "you" : c ? `${p.name} · message` : p.isGM ? "GM · message" : "message"}
            />
          </ListItemButton>
        );
      })}
      <NewPrivateDialog chat={chat} open={newPrivate} onClose={() => setNewPrivate(false)} />
    </List>
  );
}

function MemberChecklist(props: { selected: string[]; onChange: (s: string[]) => void }) {
  return (
    <Stack>
      {Object.values(people)
        .filter((p) => !p.isGM)
        .map((p) => {
          const c = characterOf(p.uid);
          return (
            <FormControlLabel
              key={p.uid}
              control={
                <Checkbox
                  checked={props.selected.includes(p.uid)}
                  onChange={(e) =>
                    props.onChange(e.target.checked ? [...props.selected, p.uid] : props.selected.filter((u) => u !== p.uid))
                  }
                />
              }
              label={c ? `${c.name} (${p.name})` : p.name}
            />
          );
        })}
    </Stack>
  );
}

function NewPrivateDialog(props: { chat: PrototypeChat; open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("Side quest");
  const [members, setMembers] = useState<string[]>([]);
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth={"xs"}>
      <DialogTitle>New private channel</DialogTitle>
      <DialogContent>
        <TextField fullWidth label={"Name"} value={title} onChange={(e) => setTitle(e.target.value)} sx={{ my: 1 }} />
        <Typography variant={"subtitle2"}>Who&apos;s in it (GMs always are)</Typography>
        <MemberChecklist selected={members} onChange={setMembers} />
      </DialogContent>
      <DialogActions>
        <Button color={"inherit"} onClick={props.onClose}>Cancel</Button>
        <Button
          variant={"contained"}
          disabled={!members.length}
          onClick={() => {
            props.chat.createPrivateChannel(title, members);
            props.onClose();
          }}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ChannelHeader(props: { chat: PrototypeChat; compact?: boolean }) {
  const { chat } = props;
  const c = chat.channel;
  const [editing, setEditing] = useState(false);
  const [members, setMembers] = useState<string[]>(c.members ?? []);
  useEffect(() => setMembers(c.members ?? []), [c.id, c.members]);
  return (
    <Stack direction={"row"} alignItems={"center"} spacing={1} sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", minHeight: 52 }}>
      <Typography fontWeight={700} noWrap sx={{ flexGrow: 1 }}>
        {channelLabel(c)}{" "}
        <Typography component={"span"} variant={"caption"} color={"text.secondary"}>
          {c.dm ? "direct message" : c.members ? `private · ${c.kind}` : c.kind}
        </Typography>
      </Typography>
      {c.members && (
        <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 26, height: 26, fontSize: 12 } }}>
          {c.members.map((uid) => (
            <SpeakerAvatar key={uid} speaker={personSpeaker(uid)} authorUid={uid} size={26} />
          ))}
        </AvatarGroup>
      )}
      {chat.viewAsGM && c.members && !c.dm && (
        <Button size={"small"} startIcon={<PeopleIcon />} onClick={() => setEditing(true)}>
          Members
        </Button>
      )}
      <Dialog open={editing} onClose={() => setEditing(false)} fullWidth maxWidth={"xs"}>
        <DialogTitle>Who&apos;s in {c.name}</DialogTitle>
        <DialogContent>
          <MemberChecklist selected={members} onChange={setMembers} />
          <Typography variant={"caption"} color={"text.secondary"}>
            Anyone you remove loses access straight away.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color={"inherit"} onClick={() => setEditing(false)}>Cancel</Button>
          <Button
            variant={"contained"}
            onClick={() => {
              chat.setMembers(c.id, members);
              setEditing(false);
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function Feed(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView();
  }, [chat.posts.length, chat.channel.id]);
  return (
    <Box sx={{ flexGrow: 1, overflowY: "auto", py: 1 }}>
      {chat.posts.map((p) => (
        <FlatPost key={p.id} chat={chat} post={p} />
      ))}
      {!chat.posts.length && (
        <Typography color={"text.secondary"} sx={{ p: 3, textAlign: "center" }}>
          Nothing here yet.
        </Typography>
      )}
      <div ref={end} />
    </Box>
  );
}

function FlatPost(props: { chat: PrototypeChat; post: Post }) {
  const { chat, post } = props;
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <Stack direction={"row"} spacing={1.5} sx={{ px: 2, py: 1, "&:hover": { bgcolor: "action.hover" } }}>
      <SpeakerAvatar speaker={post.speaker} authorUid={post.authorUid} size={40} />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Stack direction={"row"} alignItems={"center"} spacing={1}>
          <SpeakerLabel post={post} />
          <Typography variant={"caption"} color={"text.secondary"}>
            {timeLabel(post.createdAt)}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <PostMenu chat={chat} post={post} onEdit={() => setEditing(true)} />
        </Stack>
        <PostBody chat={chat} post={post} editing={editing} setEditing={setEditing} />
        <PostImages images={post.images} />
        {post.roll && (
          <Box sx={{ mt: 0.5 }}>
            <Box
              component={"button"}
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
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
                bgcolor: theme.palette.darkGrey.dark,
                color: theme.palette.darkGrey.contrastText,
                borderLeft: 4,
                borderLeftStyle: "solid",
                borderLeftColor: post.roll?.gmsOnly ? theme.palette.warning.main : theme.palette.primary.main,
              })}
            >
              <DiceIcon fontSize={"small"} />
              <span>{getRollTitle(post.roll)}</span>
              <b>{rollSummary(post.roll)}</b>
            </Box>
            <Collapse in={expanded}>
              <Box sx={{ mt: 1, maxWidth: 420 }}>
                <PostRoll post={post} />
              </Box>
            </Collapse>
          </Box>
        )}
      </Box>
    </Stack>
  );
}

function Composer(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const attach = useAttachHandlers(chat);
  const [picker, setPicker] = useState<RollKind | null>(null);
  const options = SpeakerOptions(chat);
  const character = chat.speaker.kind === "character" ? characters[chat.speaker.characterId] : characterOf(chat.myUid);
  return (
    <Box {...attach.dropProps} sx={{ borderTop: 1, borderColor: "divider", p: 1, bgcolor: attach.dragging ? "action.hover" : "background.paper" }}>
      {attach.fileInput}
      <DraftPreview chat={chat} />
      <Stack direction={"row"} spacing={1} alignItems={"center"} sx={{ px: 0.5, pb: 0.5 }}>
        <SpeakerAvatar speaker={chat.speaker} authorUid={chat.myUid} size={22} />
        {chat.viewAsGM ? (
          <Select
            size={"small"}
            variant={"standard"}
            value={speakerKey(chat.speaker)}
            onChange={(e) => {
              const o = options.find((x) => x.key === e.target.value);
              if (o) chat.setSpeaker(o.speaker);
            }}
          >
            {options.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        ) : (
          <Typography variant={"body2"} color={"text.secondary"}>
            Posting as <b>{speakerName(chat.speaker, chat.myUid)}</b>
            {chat.channel.kind === "OOC" ? " (out of character)" : ""}
          </Typography>
        )}
      </Stack>
      <Stack direction={"row"} spacing={1} alignItems={"flex-end"}>
        <TextField
          multiline
          maxRows={8}
          size={"small"}
          fullWidth
          placeholder={attach.dragging ? "Drop images to attach" : `Message ${channelLabel(chat.channel)}`}
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
        {(Object.keys(rollKindLabels) as RollKind[])
          .filter((k) => !chat.viewAsGM || k === "oracle" || k === "dice")
          .map((k) => (
            <Button key={k} size={"small"} variant={"outlined"} color={"inherit"} onClick={() => setPicker(k)} sx={{ flexShrink: 0 }}>
              {rollKindLabels[k]}
            </Button>
          ))}
      </Stack>
      <RollPicker kind={picker} character={character} onClose={() => setPicker(null)} onRoll={chat.attachExactRoll} />
    </Box>
  );
}

function CampaignScreens() {
  const [tab, setTab] = useState("Character");
  return (
    <>
      <StyledTabs value={tab} onChange={(_, v) => setTab(v)} variant={"scrollable"}>
        {["Character", "Tracks", "World", "My notes"].map((t) => (
          <StyledTab key={t} label={t} value={t} />
        ))}
      </StyledTabs>
      <PlaceholderScreen name={tab} />
    </>
  );
}

const phoneScreens = [
  { key: "Chat", icon: <ChatIcon /> },
  { key: "Character", icon: <PersonIcon /> },
  { key: "Tracks", icon: <TrackIcon /> },
  { key: "World", icon: <WorldIcon /> },
  { key: "My notes", icon: <NotesIcon /> },
];

function Phone(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const [screen, setScreen] = useState("Chat");
  const [peopleOpen, setPeopleOpen] = useState(false);
  return (
    <Card variant={"outlined"} sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", mx: -2 }}>
      {screen === "Chat" ? (
        <>
          <Stack direction={"row"} spacing={1} sx={{ p: 1, overflowX: "auto", borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
            <Chip icon={<PeopleIcon />} label={"All"} variant={"outlined"} onClick={() => setPeopleOpen(true)} />
            {chat.channels
              .filter((c) => !c.archived || c.id === chat.channel.id)
              .map((c) => (
                <Chip
                  key={c.id}
                  icon={c.members && !c.dm ? <LockIcon /> : undefined}
                  label={`${c.dm ? "@" : ""}${c.name}${chat.unreadCount(c.id) ? ` · ${chat.unreadCount(c.id)}` : ""}`}
                  color={c.id === chat.channel.id ? "primary" : "default"}
                  variant={c.id === chat.channel.id ? "filled" : "outlined"}
                  onClick={() => chat.setChannelId(c.id)}
                />
              ))}
          </Stack>
          <ChannelHeader chat={chat} compact />
          <Feed chat={chat} />
          {!chat.channel.archived && <Composer chat={chat} />}
        </>
      ) : (
        <Box sx={{ flexGrow: 1 }}>
          <PlaceholderScreen name={screen} />
        </Box>
      )}
      <Paper square elevation={3}>
        <BottomNavigation showLabels value={screen} onChange={(_, v) => setScreen(v)}>
          {phoneScreens.map((s) => (
            <BottomNavigationAction key={s.key} value={s.key} label={s.key} icon={s.icon} />
          ))}
        </BottomNavigation>
      </Paper>
      <Drawer open={peopleOpen} onClose={() => setPeopleOpen(false)}>
        <Box sx={{ width: 280 }}>
          <Sidebar chat={chat} onPick={() => setPeopleOpen(false)} />
        </Box>
      </Drawer>
    </Card>
  );
}

