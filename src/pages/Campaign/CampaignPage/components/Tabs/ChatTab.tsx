import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/AddCircleOutline";
import LockIcon from "@mui/icons-material/Lock";
import ChatIcon from "@mui/icons-material/Forum";
import PersonIcon from "@mui/icons-material/Person";
import TracksIcon from "@mui/icons-material/LinearScale";
import WorldIcon from "@mui/icons-material/Public";
import NotesIcon from "@mui/icons-material/StickyNote2";
import { StyledTab, StyledTabs } from "components/shared/StyledTabs";
import { useStore } from "stores/store";
import { useListenToChatChannels } from "stores/chat/useListenToChatChannels";
import { useListenToChannelPosts } from "stores/chat/useListenToChannelPosts";
import { createChannel } from "api-calls/chat/createChannel";
import { createPrivateChannel } from "api-calls/chat/createPrivateChannel";
import { getOrCreateDirectChannel } from "api-calls/chat/getOrCreateDirectChannel";
import { setChannelMembers } from "api-calls/chat/setChannelMembers";
import { renameChannel } from "api-calls/chat/renameChannel";
import { archiveChannel } from "api-calls/chat/archiveChannel";
import type { ChannelKind } from "api-calls/chat/_chat.type";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import { UserAvatar } from "components/shared/UserAvatar";
import { ChatFeed } from "./ChatFeed";
import { ChatComposer } from "./ChatComposer";
import { CharacterTab } from "./CharacterTab";
import { TracksTab } from "./TracksTab";
import { MyNotesTab } from "./MyNotesTab";
import { WorldTab } from "./WorldTab";

export interface RosterEntry {
  uid: string;
  displayName: string;
  isGM: boolean;
}

function channelLabel(channel: ChannelWithId, directName?: string): string {
  if (channel.visibility === "dm") {
    return `@ ${directName ?? channel.name}`;
  }
  return `# ${channel.name}`;
}

function kindLabel(channel: ChannelWithId): string {
  if (channel.visibility === "dm") {
    return "direct message";
  }
  if (channel.visibility === "private") {
    return `private · ${channel.kind === "IC" ? "in character" : "out of character"}`;
  }
  return channel.kind === "IC" ? "in character" : "out of character";
}

function sortChannels(channels: ChannelWithId[]): ChannelWithId[] {
  return [...channels].sort((a, b) => {
    if (a.isStarting !== b.isStarting) return a.isStarting ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Chat-first campaign screen (spec #9, prototype variant D): the channel
 * list beside the feed, with the other campaign screens one step away. Posts
 * arrive in the feed below: the latest page first, older pages on scroll,
 * new posts live, and the composer keeps an unsent draft per channel.
 * My notes (ticket #31) sits in the side screens from md up and on the
 * bottom navigation below md, so it stays one step from chat at every
 * width (ticket #122).
 *
 * Private channels sit under their own section with a lock: GMs create them
 * for chosen people and move people in and out at any time, and only their
 * members (plus the campaign's GMs) ever see them. Direct messages sit
 * beside them, named for the other person; anyone opens one from the People
 * list, and nobody else -- not even the GMs -- ever sees it.
 */
export function ChatTab(props: { openInviteDialog: () => void }) {
  const { openInviteDialog } = props;
  useListenToChatChannels();
  useListenToChannelPosts();
  const theme = useTheme();
  const showSideScreens = useMediaQuery(theme.breakpoints.up("md"));

  const channels = useStore((store) => store.chat.channels);
  const membersByChannel = useStore(
    (store) => store.chat.membersByChannel ?? {}
  );
  const openChannelId = useStore((store) => store.chat.openChannelId);
  const setOpenChannelId = useStore((store) => store.chat.setOpenChannelId);
  const campaignId = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaignId
  );
  const currentCampaign = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaign
  );
  const gmIds = currentCampaign?.gmIds ?? [];
  const rosterIds = currentCampaign?.users ?? [];
  const uid = useStore((store) => store.auth.uid);
  const isGM = gmIds.includes(uid);
  const userMap = useStore((store) => store.users.userMap ?? {});
  const loadUserDocuments = useStore((store) => store.users.loadUserDocuments);

  const [showArchived, setShowArchived] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [phoneScreen, setPhoneScreen] = useState<PhoneScreen>("Chat");
  const [createKind, setCreateKind] = useState<ChannelKind | undefined>(
    undefined
  );
  const [createPrivate, setCreatePrivate] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [managingMembers, setManagingMembers] = useState(false);

  const roster: RosterEntry[] = rosterIds.map((id) => ({
    uid: id,
    displayName: userMap[id]?.doc?.displayName ?? "Someone",
    isGM: gmIds.includes(id),
  }));

  useEffect(() => {
    const ids = new Set(rosterIds);
    for (const members of Object.values(membersByChannel)) {
      for (const id of members) {
        ids.add(id);
      }
    }
    if (ids.size > 0) {
      loadUserDocuments?.([...ids]);
    }
    // Names for the roster and the rosters, not the channels array: loading
    // only when the set of known people changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify([...rosterIds].sort()), JSON.stringify(membersByChannel), loadUserDocuments]);

  const directName = (channelId: string): string | undefined => {
    const other = (membersByChannel[channelId] ?? []).find(
      (id) => id !== uid
    );
    return other ? userMap[other]?.doc?.displayName : undefined;
  };

  const openChannel = channels.find((channel) => channel.id === openChannelId);
  const open = channels.filter((channel) => !channel.archived);

  const pick = (id: string) => {
    setOpenChannelId(id);
  };

  const openDirectChannel = (otherId: string) => {
    if (!campaignId || otherId === uid) {
      return;
    }
    getOrCreateDirectChannel({ campaignId, otherUserId: otherId })
      .then((id) => {
        setOpenChannelId(id);
      })
      .catch(() => {});
  };

  const listProps = {
    channels,
    membersByChannel,
    openChannelId,
    roster,
    uid,
    isGM,
    showArchived,
    setShowArchived,
    directName,
    onPick: pick,
    onCreate: setCreateKind,
    onCreatePrivate: () => setCreatePrivate(true),
    onOpenDirectChannel: openDirectChannel,
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
        <ChannelList {...listProps} />
      </Box>
      <Box
        sx={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        {phoneScreen === "Chat" ? (
          <>
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
                  label={channelLabel(channel, directName(channel.id))}
                  color={channel.id === openChannelId ? "primary" : "default"}
                  onClick={() => pick(channel.id)}
                />
              ))}
            </Stack>
            <ChannelHeader
              channel={openChannel}
              members={openChannel ? membersByChannel[openChannel.id] ?? [] : []}
              directName={openChannel ? directName(openChannel.id) : undefined}
              userMap={userMap}
              isGM={isGM}
              onRename={() => setRenaming(true)}
              onMembers={() => setManagingMembers(true)}
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
          </>
        ) : (
          <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
            {phoneScreen === "Character" && (
              <CharacterTab openInviteDialog={openInviteDialog} />
            )}
            {phoneScreen === "Tracks" && <TracksTab />}
            {phoneScreen === "World" && <WorldTab />}
            {phoneScreen === "My notes" && <MyNotesTab />}
          </Box>
        )}
        <PhoneBottomNavigation screen={phoneScreen} onPick={setPhoneScreen} />
      </Box>
      {showSideScreens && (
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
            {...listProps}
            onPick={(id) => {
              pick(id);
              setPeopleOpen(false);
            }}
            onOpenDirectChannel={(otherId) => {
              openDirectChannel(otherId);
              setPeopleOpen(false);
            }}
          />
        </Box>
      </Drawer>
      <CreateChannelDialog
        campaignId={campaignId}
        kind={createKind}
        onClose={() => setCreateKind(undefined)}
      />
      <CreatePrivateChannelDialog
        campaignId={campaignId}
        roster={roster}
        open={createPrivate}
        onClose={() => setCreatePrivate(false)}
        onCreated={pick}
      />
      <RenameChannelDialog
        channel={renaming ? openChannel : undefined}
        onClose={() => setRenaming(false)}
      />
      <MembersDialog
        channel={managingMembers ? openChannel : undefined}
        members={openChannel ? membersByChannel[openChannel.id] ?? [] : []}
        roster={roster}
        onClose={() => setManagingMembers(false)}
      />
    </Card>
  );
}

function ChannelList(props: {
  channels: ChannelWithId[];
  membersByChannel: Record<string, string[]>;
  openChannelId?: string;
  roster: RosterEntry[];
  uid?: string;
  isGM: boolean;
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
  directName: (channelId: string) => string | undefined;
  onPick: (id: string) => void;
  onCreate: (kind: ChannelKind) => void;
  onCreatePrivate: () => void;
  onOpenDirectChannel: (uid: string) => void;
}) {
  const {
    channels,
    openChannelId,
    roster,
    uid,
    isGM,
    showArchived,
    setShowArchived,
    directName,
    onPick,
    onCreate,
    onCreatePrivate,
    onOpenDirectChannel,
  } = props;
  const open = channels.filter((channel) => !channel.archived);
  const archived = channels.filter((channel) => channel.archived);
  const publicIC = open.filter(
    (channel) => channel.kind === "IC" && channel.visibility === "public"
  );
  const publicOOC = open.filter(
    (channel) => channel.kind === "OOC" && channel.visibility === "public"
  );
  const privateChannels = open.filter(
    (channel) => channel.visibility === "private"
  );
  const directChannels = open.filter((channel) => channel.visibility === "dm");

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
      {channel.visibility === "private" && (
        <LockIcon sx={{ fontSize: 14, mr: 0.75, opacity: 0.6 }} />
      )}
      <ListItemText
        primary={channelLabel(channel, directName(channel.id))}
        primaryTypographyProps={{ noWrap: true }}
      />
    </ListItemButton>
  );

  return (
    <List dense>
      {header("In character", "IC")}
      {sortChannels(publicIC).map(item)}
      {header("Out of character", "OOC")}
      {sortChannels(publicOOC).map(item)}
      {(isGM || privateChannels.length > 0) && (
        <ListSubheader
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            lineHeight: "36px",
          }}
        >
          Private
          {isGM && (
            <IconButton
              size={"small"}
              aria-label={"New Private channel"}
              onClick={onCreatePrivate}
            >
              <AddIcon fontSize={"small"} />
            </IconButton>
          )}
        </ListSubheader>
      )}
      {sortChannels(privateChannels).map(item)}
      {directChannels.length > 0 && <ListSubheader>Direct messages</ListSubheader>}
      {sortChannels(directChannels).map(item)}
      <ListSubheader>People</ListSubheader>
      {roster.map((person) => (
        <ListItemButton
          key={person.uid}
          component={"button"}
          disabled={person.uid === uid}
          onClick={() => onOpenDirectChannel(person.uid)}
        >
          <ListItemAvatar sx={{ minWidth: 40 }}>
            <UserAvatar
              uid={person.uid}
              forceName={person.displayName}
              forceShowPhoto
            />
          </ListItemAvatar>
          <ListItemText
            primary={person.displayName}
            secondary={
              person.uid === uid
                ? "you"
                : person.isGM
                  ? "GM · message"
                  : "message"
            }
          />
        </ListItemButton>
      ))}
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
  members: string[];
  directName?: string;
  userMap: Record<string, { doc?: { displayName: string } } | undefined>;
  isGM: boolean;
  onRename: () => void;
  onMembers: () => void;
  onArchive: (archived: boolean) => void;
}) {
  const { channel, members, directName, userMap, isGM, onRename, onMembers, onArchive } =
    props;
  if (!channel) {
    return null;
  }
  const isDirectChannel = channel.visibility === "dm";
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
        {channelLabel(channel, directName)}{" "}
        <Typography
          component={"span"}
          variant={"caption"}
          color={"text.secondary"}
        >
          {kindLabel(channel)}
        </Typography>
      </Typography>
      {channel.visibility === "private" && members.length > 0 && (
        <AvatarGroup max={4}>
          {members.map((id) => (
            <UserAvatar
              key={id}
              uid={id}
              forceName={userMap[id]?.doc?.displayName ?? "Someone"}
            />
          ))}
        </AvatarGroup>
      )}
      {isGM && channel.visibility === "private" && (
        <Button size={"small"} onClick={onMembers}>
          Members
        </Button>
      )}
      {isGM && !isDirectChannel && (
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

function CreatePrivateChannelDialog(props: {
  campaignId?: string;
  roster: RosterEntry[];
  open: boolean;
  onClose: () => void;
  onCreated: (channelId: string) => void;
}) {
  const { campaignId, roster, open, onClose, onCreated } = props;
  const [name, setName] = useState("Side quest");
  const [kind, setKind] = useState<ChannelKind>("IC");
  const [selected, setSelected] = useState<string[]>([]);

  const save = () => {
    if (!campaignId) {
      return;
    }
    createPrivateChannel({
      campaignId,
      name,
      kind,
      memberIds: selected,
    })
      .then((id) => {
        setName("Side quest");
        setSelected([]);
        onClose();
        onCreated(id);
      })
      .catch(() => {});
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth={"xs"}>
      <DialogTitle>New private channel</DialogTitle>
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
          value={kind}
          onChange={(e) => setKind(e.target.value as ChannelKind)}
          sx={{ mb: 1 }}
        >
          <MenuItem value={"IC"}>In character</MenuItem>
          <MenuItem value={"OOC"}>Out of character</MenuItem>
        </TextField>
        <Typography variant={"subtitle2"}>
          Who&apos;s in it (GMs can always see it)
        </Typography>
        <MemberChecklist
          roster={roster.filter((person) => !person.isGM)}
          selected={selected}
          onChange={setSelected}
        />
      </DialogContent>
      <DialogActions>
        <Button color={"inherit"} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={"contained"}
          disabled={!name.trim() || selected.length === 0}
          onClick={save}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MembersDialog(props: {
  channel?: ChannelWithId;
  members: string[];
  roster: RosterEntry[];
  onClose: () => void;
}) {
  const { channel, members, roster, onClose } = props;
  const [selected, setSelected] = useState<string[]>(members);
  // The roster, not the dialog state: reopening for another channel (or a
  // live roster change behind the dialog) reseeds the checklist.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setSelected(members), [channel?.id, members.join(",")]);

  const save = () => {
    if (!channel) {
      return;
    }
    setChannelMembers({ channelId: channel.id, memberIds: selected })
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
      <DialogTitle>Who&apos;s in {channel ? channel.name : ""}</DialogTitle>
      <DialogContent>
        <MemberChecklist
          roster={roster.filter((person) => !person.isGM)}
          selected={selected}
          onChange={setSelected}
        />
        <Typography variant={"caption"} color={"text.secondary"}>
          Anyone you remove loses access straight away.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button color={"inherit"} onClick={onClose}>
          Cancel
        </Button>
        <Button variant={"contained"} onClick={save}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MemberChecklist(props: {
  roster: RosterEntry[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const { roster, selected, onChange } = props;
  return (
    <Stack>
      {roster.map((person) => (
        <FormControlLabel
          key={person.uid}
          control={
            <Checkbox
              checked={selected.includes(person.uid)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, person.uid]
                    : selected.filter((uid) => uid !== person.uid)
                )
              }
            />
          }
          label={person.displayName}
        />
      ))}
    </Stack>
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
      <StyledTabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant={"scrollable"}
        aria-label={"Chat side screens"}
      >
        {["Character", "Tracks", "World", "My notes"].map((name) => (
          <StyledTab key={name} label={name} value={name} />
        ))}
      </StyledTabs>
      {tab === "Character" && (
        <CharacterTab openInviteDialog={props.openInviteDialog} />
      )}
      {tab === "Tracks" && <TracksTab />}
      {tab === "World" && <WorldTab />}
      {tab === "My notes" && <MyNotesTab />}
    </>
  );
}

type PhoneScreen = "Chat" | "Character" | "Tracks" | "World" | "My notes";

const phoneScreens: Array<{
  key: PhoneScreen;
  icon: ReactNode;
}> = [
  { key: "Chat", icon: <ChatIcon /> },
  { key: "Character", icon: <PersonIcon /> },
  { key: "Tracks", icon: <TracksIcon /> },
  { key: "World", icon: <WorldIcon /> },
  { key: "My notes", icon: <NotesIcon /> },
];

function PhoneBottomNavigation(props: {
  screen: PhoneScreen;
  onPick: (screen: PhoneScreen) => void;
}) {
  const { screen, onPick } = props;
  return (
    <Paper
      square
      elevation={3}
      sx={{ display: { xs: "block", md: "none" }, flexShrink: 0 }}
    >
      <BottomNavigation
        showLabels
        value={screen}
        onChange={(_, next) => onPick(next)}
      >
        {phoneScreens.map((item) => (
          <BottomNavigationAction
            key={item.key}
            value={item.key}
            label={item.key}
            icon={item.icon}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
