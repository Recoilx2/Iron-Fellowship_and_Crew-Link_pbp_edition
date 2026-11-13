import { useState } from "react";
import {
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/AddCircleOutline";
import { StyledTab, StyledTabs } from "components/shared/StyledTabs";
import { useStore } from "stores/store";
import { useListenToChatChannels } from "stores/chat/useListenToChatChannels";
import { useListenToChannelPosts } from "stores/chat/useListenToChannelPosts";
import { createChannel } from "api-calls/chat/createChannel";
import { renameChannel } from "api-calls/chat/renameChannel";
import { archiveChannel } from "api-calls/chat/archiveChannel";
import type { ChannelKind } from "api-calls/chat/_chat.type";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import { ChatFeed } from "./ChatFeed";
import { ChatComposer } from "./ChatComposer";
import { CharacterTab } from "./CharacterTab";
import { TracksTab } from "./TracksTab";
import { NotesTab } from "./NotesTab";
import { WorldTab } from "./WorldTab";

function channelLabel(channel: ChannelWithId): string {
  return `# ${channel.name}`;
}

function sortChannels(channels: ChannelWithId[]): ChannelWithId[] {
  return [...channels].sort((a, b) => {
    if (a.isStarting !== b.isStarting) return a.isStarting ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Chat-first campaign screen (spec #9, prototype variant D): the channel
 * list beside the feed, with the other campaign tabs one step away. Posts
 * arrive in the feed below: the latest page first, older pages on scroll,
 * new posts live, and the composer keeps an unsent draft per channel.
 */
export function ChatTab(props: { openInviteDialog: () => void }) {
  const { openInviteDialog } = props;
  useListenToChatChannels();
  useListenToChannelPosts();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("lg"));

  const channels = useStore((store) => store.chat.channels);
  const openChannelId = useStore((store) => store.chat.openChannelId);
  const setOpenChannelId = useStore((store) => store.chat.setOpenChannelId);
  const campaignId = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaignId
  );
  const gmIds = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaign?.gmIds ?? []
  );
  const uid = useStore((store) => store.auth.uid);
  const isGM = gmIds.includes(uid);

  const [showArchived, setShowArchived] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [createKind, setCreateKind] = useState<ChannelKind | undefined>(
    undefined
  );
  const [renaming, setRenaming] = useState(false);

  const openChannel = channels.find((channel) => channel.id === openChannelId);
  const open = channels.filter((channel) => !channel.archived);

  const pick = (id: string) => {
    setOpenChannelId(id);
  };

  return (
    <Card
      variant={"outlined"}
      sx={{ height: "100%", display: "flex", overflow: "hidden" }}
    >
      <Box
        sx={{
          width: 250,
          flexShrink: 0,
          borderRight: 1,
          borderColor: "divider",
          overflowY: "auto",
          display: { xs: "none", md: "block" },
        }}
      >
        <ChannelList
          channels={channels}
          openChannelId={openChannelId}
          isGM={isGM}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          onPick={pick}
          onCreate={setCreateKind}
        />
      </Box>
      <Box
        sx={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        <Stack
          direction={"row"}
          spacing={1}
          sx={{
            p: 1,
            overflowX: "auto",
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
            display: { xs: "flex", md: "none" },
          }}
        >
          <Chip
            label={"All"}
            variant={"outlined"}
            onClick={() => setPeopleOpen(true)}
          />
          {open.map((channel) => (
            <Chip
              key={channel.id}
              label={channel.name}
              color={channel.id === openChannelId ? "primary" : "default"}
              onClick={() => pick(channel.id)}
            />
          ))}
        </Stack>
        <ChannelHeader
          channel={openChannel}
          isGM={isGM}
          onRename={() => setRenaming(true)}
          onArchive={(archived) =>
            openChannel &&
            archiveChannel({ channelId: openChannel.id, archived }).catch(
              () => {}
            )
          }
        />
        {openChannel ? (
          <>
            <ChatFeed channel={openChannel} />
            {openChannel.archived ? (
              <Typography
                color={"text.secondary"}
                sx={{
                  p: 1.5,
                  textAlign: "center",
                  borderTop: 1,
                  borderColor: "divider",
                }}
              >
                This channel is archived. New posts are closed.
              </Typography>
            ) : (
              <ChatComposer
                key={openChannel.id}
                channel={openChannel}
                campaignId={campaignId ?? ""}
              />
            )}
          </>
        ) : (
          <Box sx={{ flexGrow: 1, overflowY: "auto", py: 1 }}>
            <Typography
              color={"text.secondary"}
              sx={{ p: 3, textAlign: "center" }}
            >
              Posts in this channel appear here.
            </Typography>
          </Box>
        )}
      </Box>
      {wide && (
        <Box
          sx={{
            width: 360,
            flexShrink: 0,
            borderLeft: 1,
            borderColor: "divider",
            overflowY: "auto",
          }}
        >
          <CampaignScreens openInviteDialog={openInviteDialog} />
        </Box>
      )}
      <Drawer open={peopleOpen} onClose={() => setPeopleOpen(false)}>
        <Box sx={{ width: 280 }}>
          <ChannelList
            channels={channels}
            openChannelId={openChannelId}
            isGM={isGM}
            showArchived={showArchived}
            setShowArchived={setShowArchived}
            onPick={(id) => {
              pick(id);
              setPeopleOpen(false);
            }}
            onCreate={setCreateKind}
          />
        </Box>
      </Drawer>
      <CreateChannelDialog
        campaignId={campaignId}
        kind={createKind}
        onClose={() => setCreateKind(undefined)}
      />
      <RenameChannelDialog
        channel={renaming ? openChannel : undefined}
        onClose={() => setRenaming(false)}
      />
    </Card>
  );
}

function ChannelList(props: {
  channels: ChannelWithId[];
  openChannelId?: string;
  isGM: boolean;
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
  onPick: (id: string) => void;
  onCreate: (kind: ChannelKind) => void;
}) {
  const {
    channels,
    openChannelId,
    isGM,
    showArchived,
    setShowArchived,
    onPick,
    onCreate,
  } = props;
  const open = channels.filter((channel) => !channel.archived);
  const archived = channels.filter((channel) => channel.archived);

  const header = (label: string, kind?: ChannelKind) => (
    <ListSubheader
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        lineHeight: "36px",
      }}
    >
      {label}
      {isGM && kind && (
        <IconButton
          size={"small"}
          aria-label={`New ${label} channel`}
          onClick={() => onCreate(kind)}
        >
          <AddIcon fontSize={"small"} />
        </IconButton>
      )}
    </ListSubheader>
  );

  const item = (channel: ChannelWithId) => (
    <ListItemButton
      key={channel.id}
      component={"button"}
      selected={channel.id === openChannelId}
      onClick={() => onPick(channel.id)}
      sx={{ color: channel.archived ? "text.secondary" : undefined }}
    >
      <ListItemText
        primary={channelLabel(channel)}
        primaryTypographyProps={{ noWrap: true }}
      />
    </ListItemButton>
  );

  return (
    <List dense>
      {header("In character", "IC")}
      {sortChannels(open.filter((channel) => channel.kind === "IC")).map(item)}
      {header("Out of character", "OOC")}
      {sortChannels(open.filter((channel) => channel.kind === "OOC")).map(item)}
      <ListItemButton onClick={() => setShowArchived(!showArchived)}>
        <ListItemText
          secondary={showArchived ? "Hide archived" : "Show archived"}
        />
      </ListItemButton>
      <Collapse in={showArchived} unmountOnExit>
        {sortChannels(archived).map(item)}
      </Collapse>
    </List>
  );
}

function ChannelHeader(props: {
  channel?: ChannelWithId;
  isGM: boolean;
  onRename: () => void;
  onArchive: (archived: boolean) => void;
}) {
  const { channel, isGM, onRename, onArchive } = props;
  if (!channel) {
    return null;
  }
  return (
    <Stack
      direction={"row"}
      alignItems={"center"}
      spacing={1}
      sx={{
        px: 2,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
        minHeight: 52,
      }}
    >
      <Typography fontWeight={700} noWrap sx={{ flexGrow: 1 }}>
        {channelLabel(channel)}{" "}
        <Typography
          component={"span"}
          variant={"caption"}
          color={"text.secondary"}
        >
          {channel.kind === "IC" ? "in character" : "out of character"}
        </Typography>
      </Typography>
      {isGM && (
        <>
          <Button size={"small"} onClick={onRename}>
            Rename
          </Button>
          {channel.archived ? (
            <Button size={"small"} onClick={() => onArchive(false)}>
              Reopen
            </Button>
          ) : (
            <Button
              size={"small"}
              disabled={channel.isStarting}
              title={
                channel.isStarting
                  ? "Starting channels stay"
                  : "Archive this channel"
              }
              onClick={() => onArchive(true)}
            >
              Archive
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}

function CreateChannelDialog(props: {
  campaignId?: string;
  kind?: ChannelKind;
  onClose: () => void;
}) {
  const { campaignId, kind, onClose } = props;
  const [name, setName] = useState("");
  const [channelKind, setChannelKind] = useState<ChannelKind>("IC");
  const open = kind !== undefined;
  const effectiveKind = kind ?? channelKind;

  const save = () => {
    if (!campaignId) {
      return;
    }
    createChannel({ campaignId, name, kind: effectiveKind })
      .then(() => {
        setName("");
        onClose();
      })
      .catch(() => {});
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth={"xs"}>
      <DialogTitle>New channel</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          label={"Name"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ my: 1 }}
        />
        <TextField
          select
          fullWidth
          label={"Kind"}
          value={kind ?? channelKind}
          onChange={(e) => setChannelKind(e.target.value as ChannelKind)}
          disabled={kind !== undefined}
        >
          <MenuItem value={"IC"}>In character</MenuItem>
          <MenuItem value={"OOC"}>Out of character</MenuItem>
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button color={"inherit"} onClick={onClose}>
          Cancel
        </Button>
        <Button variant={"contained"} disabled={!name.trim()} onClick={save}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RenameChannelDialog(props: {
  channel?: ChannelWithId;
  onClose: () => void;
}) {
  const { channel, onClose } = props;
  const [name, setName] = useState(channel?.name ?? "");

  const save = () => {
    if (!channel) {
      return;
    }
    renameChannel({ channelId: channel.id, name })
      .then(() => onClose())
      .catch(() => {});
  };

  return (
    <Dialog
      open={channel !== undefined}
      onClose={onClose}
      fullWidth
      maxWidth={"xs"}
    >
      <DialogTitle>Rename {channel ? channelLabel(channel) : ""}</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          label={"Name"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ my: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button color={"inherit"} onClick={onClose}>
          Cancel
        </Button>
        <Button variant={"contained"} disabled={!name.trim()} onClick={save}>
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CampaignScreens(props: { openInviteDialog: () => void }) {
  const [tab, setTab] = useState("Character");
  return (
    <>
      <StyledTabs value={tab} onChange={(_, v) => setTab(v)} variant={"scrollable"}>
        {["Character", "Tracks", "World", "Notes"].map((name) => (
          <StyledTab key={name} label={name} value={name} />
        ))}
      </StyledTabs>
      {tab === "Character" && (
        <CharacterTab openInviteDialog={props.openInviteDialog} />
      )}
      {tab === "Tracks" && <TracksTab />}
      {tab === "World" && <WorldTab />}
      {tab === "Notes" && <NotesTab />}
    </>
  );
}
