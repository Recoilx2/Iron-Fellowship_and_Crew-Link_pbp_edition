// PROTOTYPE (#6) Variant B: "Three panes".
// Desktop: channel list | flat feed | the campaign screens beside chat.
// Mobile: channels in a slide-out drawer, campaign screens in a full-screen
// sheet. Rolls are compact one-line results that expand on tap. The
// composer has one "+" menu for images and rolls.
import {
  Box,
  Button,
  Card,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/AddCircleOutline";
import SendIcon from "@mui/icons-material/Send";
import MenuIcon from "@mui/icons-material/Menu";
import SheetIcon from "@mui/icons-material/AssignmentInd";
import CloseIcon from "@mui/icons-material/Close";
import { useEffect, useRef, useState } from "react";
import { StyledTab, StyledTabs } from "components/shared/StyledTabs";
import { ROLL_RESULT, ROLL_TYPE, Roll } from "types/DieRolls.type";
import { getRollTitle } from "functions/rollText";
import { PrototypeChat, Post, RollKind, rollKindLabels } from "./usePrototypeChat";
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
  timeLabel,
  useAttachHandlers,
} from "./shared";

export const name = "Three panes";

function rollSummary(roll: Roll) {
  const outcome = (r: ROLL_RESULT) => (r === ROLL_RESULT.HIT ? "Strong hit" : r === ROLL_RESULT.WEAK_HIT ? "Weak hit" : "Miss");
  switch (roll.type) {
    case ROLL_TYPE.STAT:
      return `${outcome(roll.result)} · ${roll.action} vs ${roll.challenge1}, ${roll.challenge2}`;
    case ROLL_TYPE.TRACK_PROGRESS:
      return `${outcome(roll.result)} · ${roll.trackProgress} vs ${roll.challenge1}, ${roll.challenge2}`;
    case ROLL_TYPE.ORACLE_TABLE:
    case ROLL_TYPE.CLOCK_PROGRESSION:
      return `${roll.result} (${Array.isArray(roll.roll) ? roll.roll.join(", ") : roll.roll})`;
    case ROLL_TYPE.CUSTOM_DICE:
      return `${roll.total} (${roll.dieValues.join(" + ")})`;
  }
}

export function VariantB(props: { chat: PrototypeChat }) {
  const { chat } = props;
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("lg"));
  const medium = useMediaQuery(theme.breakpoints.up("md"));
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const channelList = <ChannelList chat={chat} onPick={() => setChannelsOpen(false)} />;
  const screens = <CampaignScreens />;

  return (
    <Card variant={"outlined"} sx={{ height: "100%", display: "flex", overflow: "hidden", mx: { xs: -2, sm: 0 } }}>
      {medium ? (
        <Box sx={{ width: 230, flexShrink: 0, borderRight: 1, borderColor: "divider", overflowY: "auto" }}>{channelList}</Box>
      ) : (
        <Drawer open={channelsOpen} onClose={() => setChannelsOpen(false)}>
          <Box sx={{ width: 260 }}>{channelList}</Box>
        </Drawer>
      )}

      <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Stack direction={"row"} alignItems={"center"} spacing={1} sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          {!medium && (
            <IconButton onClick={() => setChannelsOpen(true)} aria-label={"Channels"}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography fontWeight={700} noWrap sx={{ flexGrow: 1 }}>
            # {chat.channel.name}{" "}
            <Typography component={"span"} variant={"caption"} color={"text.secondary"}>
              {chat.channel.kind}
            </Typography>
          </Typography>
          {!wide && (
            <Button startIcon={<SheetIcon />} size={"small"} onClick={() => setSheetOpen(true)}>
              Sheet &amp; more
            </Button>
          )}
        </Stack>
        <Feed chat={chat} />
        {!chat.channel.archived && <Composer chat={chat} />}
      </Box>

      {wide ? (
        <Box sx={{ width: 380, flexShrink: 0, borderLeft: 1, borderColor: "divider", overflowY: "auto" }}>{screens}</Box>
      ) : (
        <Drawer anchor={"right"} open={sheetOpen} onClose={() => setSheetOpen(false)} PaperProps={{ sx: { width: { xs: "100%", sm: 420 } } }}>
          <Stack direction={"row"} justifyContent={"flex-end"}>
            <IconButton onClick={() => setSheetOpen(false)} aria-label={"Back to chat"}>
              <CloseIcon />
            </IconButton>
          </Stack>
          {screens}
        </Drawer>
      )}
    </Card>
  );
}

function ChannelList(props: { chat: PrototypeChat; onPick: () => void }) {
  const { chat, onPick } = props;
  const [showArchived, setShowArchived] = useState(false);
  const section = (kind: "IC" | "OOC", label: string) => (
    <>
      <ListSubheader sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {label}
        {chat.viewAsGM && (
          <IconButton size={"small"} aria-label={`New ${kind} channel`} onClick={() => chat.createChannel(`New ${kind} channel`, kind)}>
            <AddIcon fontSize={"small"} />
          </IconButton>
        )}
      </ListSubheader>
      {chat.channels
        .filter((c) => c.kind === kind && !c.archived)
        .map((c) => (
          <ListItemButton
            key={c.id}
            selected={c.id === chat.channel.id}
            onClick={() => {
              chat.setChannelId(c.id);
              onPick();
            }}
          >
            <ListItemText primary={`# ${c.name}`} primaryTypographyProps={{ fontWeight: chat.unreadCount(c.id) ? 700 : 400, noWrap: true }} />
            {chat.unreadCount(c.id) > 0 && (
              <Typography variant={"caption"} sx={{ bgcolor: "primary.main", color: "primary.contrastText", borderRadius: 4, px: 0.75 }}>
                {chat.unreadCount(c.id)}
              </Typography>
            )}
          </ListItemButton>
        ))}
    </>
  );
  return (
    <List dense>
      {section("IC", "In character")}
      {section("OOC", "Out of character")}
      <Divider sx={{ my: 1 }} />
      <ListItemButton onClick={() => setShowArchived((s) => !s)}>
        <ListItemText secondary={showArchived ? "Hide archived" : "Show archived"} />
      </ListItemButton>
      <Collapse in={showArchived}>
        {chat.channels
          .filter((c) => c.archived)
          .map((c) => (
            <ListItemButton key={c.id} onClick={() => chat.setChannelId(c.id)} sx={{ color: "text.secondary" }}>
              <ListItemText primary={`# ${c.name}`} />
            </ListItemButton>
          ))}
      </Collapse>
    </List>
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
      <SpeakerAvatar speaker={post.speaker} authorUid={post.authorUid} />
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
            <Button
              size={"small"}
              variant={"outlined"}
              color={"inherit"}
              onClick={() => setExpanded((e) => !e)}
              sx={{ textTransform: "none", justifyContent: "flex-start" }}
            >
              🎲 {getRollTitle(post.roll)}: <b>&nbsp;{rollSummary(post.roll)}</b>
            </Button>
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
  const [plusAnchor, setPlusAnchor] = useState<HTMLElement | null>(null);
  const [speakerAnchor, setSpeakerAnchor] = useState<HTMLElement | null>(null);
  const options = SpeakerOptions(chat);
  return (
    <Box {...attach.dropProps} sx={{ p: 1.5, borderTop: 1, borderColor: "divider", bgcolor: attach.dragging ? "action.hover" : undefined }}>
      {attach.fileInput}
      <DraftPreview chat={chat} />
      <Stack direction={"row"} spacing={1} alignItems={"flex-end"}>
        <IconButton onClick={(e) => setPlusAnchor(e.currentTarget)} aria-label={"Add image or roll"}>
          <AddIcon />
        </IconButton>
        <Menu open={!!plusAnchor} anchorEl={plusAnchor} onClose={() => setPlusAnchor(null)}>
          <MenuItem
            onClick={() => {
              setPlusAnchor(null);
              attach.openPicker();
            }}
          >
            Attach image…
          </MenuItem>
          <Divider />
          {(Object.keys(rollKindLabels) as RollKind[]).map((k) => (
            <MenuItem
              key={k}
              onClick={() => {
                setPlusAnchor(null);
                chat.attachRoll(k);
              }}
            >
              Roll {rollKindLabels[k].toLowerCase()}…
            </MenuItem>
          ))}
        </Menu>
        <IconButton onClick={(e) => setSpeakerAnchor(e.currentTarget)} aria-label={"Posting as"}>
          <SpeakerAvatar speaker={chat.speaker} authorUid={chat.myUid} size={30} />
        </IconButton>
        <Menu open={!!speakerAnchor} anchorEl={speakerAnchor} onClose={() => setSpeakerAnchor(null)}>
          <ListSubheader>Post as</ListSubheader>
          {options.map((o) => (
            <MenuItem
              key={o.key}
              onClick={() => {
                chat.setSpeaker(o.speaker);
                setSpeakerAnchor(null);
              }}
            >
              {o.label}
            </MenuItem>
          ))}
        </Menu>
        <TextField
          multiline
          maxRows={8}
          size={"small"}
          fullWidth
          placeholder={attach.dragging ? "Drop images to attach" : `Message # ${chat.channel.name}`}
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
