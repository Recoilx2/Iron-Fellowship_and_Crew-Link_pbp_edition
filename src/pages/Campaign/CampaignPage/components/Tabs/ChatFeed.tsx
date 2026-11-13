import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useStore } from "stores/store";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import type { PostWithId } from "api-calls/chat/listenToChannelPosts";
import { editPost } from "api-calls/chat/editPost";
import { deletePost } from "api-calls/chat/deletePost";
import { MarkdownRenderer } from "components/shared/MarkdownRenderer";
import { PortraitAvatar } from "components/features/characters/PortraitAvatar/PortraitAvatar";
import { UserAvatar } from "components/shared/UserAvatar";
import { ChatPostImages } from "./ChatPostImages";
import type { CharacterDocument } from "api-calls/character/_character.type";
import type { NPCDocumentWithGMProperties } from "stores/world/currentWorld/npcs/npcs.slice.type";

const EMPTY_POSTS: PostWithId[] = [];
const NEAR_TOP_PX = 48;
const NEAR_BOTTOM_PX = 64;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

import { ChatRollPost } from "./ChatRollPost";

/**
 * The channel's flat feed (spec #9, prototype variant D): avatar, name
 * line, time, formatted text. In IC channels the name line leads with the
 * character, then the player; in OOC channels it leads with the player's
 * display name, then their character. A GM's NPC voice leads with the NPC's
 * name and portrait in any channel. GMs carry a GM tag. Older posts page
 * in from the top; new posts arrive live at the bottom. A roll post shows
 * its text with a dark one-line summary that expands the roll card.
 */
export function ChatFeed(props: { channel: ChannelWithId }) {
  const { channel } = props;
  const posts = useStore(
    (store) => store.chat.postsByChannel[channel.id] ?? EMPTY_POSTS
  );
  const hasOlder = useStore(
    (store) => store.chat.hasOlderByChannel[channel.id] ?? false
  );
  const postsLoading = useStore((store) => store.chat.postsLoading);
  const postsError = useStore((store) => store.chat.postsError);
  const loadOlderPosts = useStore((store) => store.chat.loadOlderPosts);
  const characterMap = useStore(
    (store) =>
      store.campaigns.currentCampaign.characters.characterMap ?? {}
  );
  const gmIds = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaign?.gmIds ?? []
  );
  const uid = useStore((store) => store.auth.uid);
  const userMap = useStore((store) => store.users.userMap);
  const npcMap = useStore(
    (store) => store.worlds.currentWorld.currentWorldNPCs.npcMap ?? {}
  );
  const loadUserDocuments = useStore(
    (store) => store.users.loadUserDocuments
  );

  const authorIds = [...new Set(posts.map((post) => post.authorId))];
  useEffect(() => {
    if (authorIds.length > 0) {
      loadUserDocuments(authorIds);
    }
    // The authors, not the posts array: re-resolving on every emit is
    // pointless, and the loader skips names it already holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorIds.join(","), loadUserDocuments]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const pinnedHeightRef = useRef(0);

  const pageBack = () => {
    const scroller = scrollerRef.current;
    if (!hasOlder || postsLoading || loadingOlderRef.current) {
      return;
    }
    if (scroller) {
      pinnedHeightRef.current = scroller.scrollHeight;
    }
    loadingOlderRef.current = true;
    loadOlderPosts(channel.id);
  };

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    stickToBottomRef.current =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
      NEAR_BOTTOM_PX;
    if (scroller.scrollTop <= NEAR_TOP_PX) {
      pageBack();
    }
  };

  // New arrivals land at the bottom, so a reader caught up stays caught up;
  // paging back pins the scroll to the first post they were reading.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    if (loadingOlderRef.current) {
      loadingOlderRef.current = false;
      scroller.scrollTop += scroller.scrollHeight - pinnedHeightRef.current;
    } else if (stickToBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [posts.length, channel.id]);

  useLayoutEffect(() => {
    stickToBottomRef.current = true;
    loadingOlderRef.current = false;
    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [channel.id]);

  return (
    <Box
      ref={scrollerRef}
      onScroll={onScroll}
      aria-label={`Posts in # ${channel.name}`}
      sx={{ flexGrow: 1, overflowY: "auto", py: 1 }}
    >
      {hasOlder && (
        <Box sx={{ display: "flex", justifyContent: "center", pb: 1 }}>
          <Button size={"small"} onClick={pageBack} disabled={postsLoading}>
            Show earlier messages
          </Button>
        </Box>
      )}
      {posts.map((post) => (
        <ChatPost
          key={post.id}
          post={post}
          channel={channel}
          uid={uid}
          characterMap={characterMap}
          npcMap={npcMap}
          gmIds={gmIds}
          userMap={userMap}
        />
      ))}
      {!postsLoading && posts.length === 0 && !postsError && (
        <Typography color={"text.secondary"} sx={{ p: 3, textAlign: "center" }}>
          Nothing here yet.
        </Typography>
      )}
      {postsError && (
        <Typography color={"error"} sx={{ p: 3, textAlign: "center" }}>
          {postsError}
        </Typography>
      )}
    </Box>
  );
}

function ChatPost(props: {
  post: PostWithId;
  channel: ChannelWithId;
  uid?: string;
  characterMap: Record<string, CharacterDocument>;
  npcMap: Record<string, NPCDocumentWithGMProperties>;
  gmIds: string[];
  userMap: Record<string, { doc?: { displayName: string } } | undefined>;
}) {
  const { post, channel, uid, characterMap, npcMap, gmIds, userMap } = props;
  const character =
    post.speakerCharacterId != null
      ? characterMap[post.speakerCharacterId]
      : undefined;
  const npc =
    post.speakerNpcId != null ? npcMap[post.speakerNpcId] : undefined;
  const authorName =
    userMap[post.authorId]?.doc?.displayName ?? "Someone";
  const isGM = gmIds.includes(post.authorId);
  const deleted = post.deletedAt != null;

  // The access rules decide: authors edit their own live posts, and the
  // author or a GM deletes. Everyone else sees the marker and the text,
  // no controls.
  const viewerIsGM = uid != null && gmIds.includes(uid);
  const canEdit = uid != null && post.authorId === uid && !deleted;
  const showDelete =
    !deleted && (post.authorId === uid || viewerIsGM);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.text);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setDraft(post.text);
    setConfirmingDelete(false);
    setEditing(true);
  };

  const saveEdit = () => {
    if (draft.trim().length === 0 || busy) {
      return;
    }
    setBusy(true);
    editPost({ postId: post.id, text: draft })
      .then(() => {
        setEditing(false);
      })
      .catch(() => {})
      .finally(() => {
        setBusy(false);
      });
  };

  const confirmDelete = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    deletePost({ postId: post.id })
      .catch(() => {})
      .finally(() => {
        setBusy(false);
        setConfirmingDelete(false);
      });
  };

  // An NPC voice leads with the NPC, then the GM behind it; otherwise IC
  // leads with the character, then the player, and OOC leads with the
  // player's display name, then their character beside it.
  const title = npc?.name ?? (channel.kind === "IC" ? (character?.name ?? authorName) : authorName);
  const subtitle = npc
    ? authorName
    : channel.kind === "IC"
      ? character
        ? authorName
        : undefined
      : character?.name;

  return (
    <Stack
      direction={"row"}
      spacing={1.5}
      sx={{ px: 2, py: 1, "&:hover": { bgcolor: "action.hover" } }}
    >
      {character ? (
        <PortraitAvatar
          uid={character.uid}
          characterId={post.speakerCharacterId as string}
          name={character.name}
          portraitSettings={
            (character.profileImage ?? undefined) as
              | {
                  filename: string;
                  position: { x: number; y: number };
                  scale: number;
                }
              | undefined
          }
          size={"small"}
        />
      ) : npc ? (
        <Avatar src={npc.imageUrl} alt={npc.name}>
          {!npc.imageUrl && npc.name ? npc.name.charAt(0) : undefined}
        </Avatar>
      ) : (
        <UserAvatar uid={post.authorId} forceName={authorName} />
      )}
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Stack direction={"row"} spacing={0.75} alignItems={"baseline"} flexWrap={"wrap"}>
          <Typography fontWeight={700}>{title}</Typography>
          {subtitle && (
            <Typography variant={"caption"} color={"text.secondary"}>
              {subtitle}
            </Typography>
          )}
          {isGM && <Chip size={"small"} label={"GM"} sx={{ height: 18 }} />}
          <Typography variant={"caption"} color={"text.secondary"}>
            {timeLabel(post.createdAt)}
          </Typography>
          {post.editedAt != null && !deleted && (
            <Typography variant={"caption"} color={"text.secondary"}>
              (edited)
            </Typography>
          )}
        </Stack>
        {deleted ? (
          <Typography
            variant={"body2"}
            color={"text.secondary"}
            sx={{ fontStyle: "italic" }}
          >
            post deleted
          </Typography>
        ) : editing ? (
          <Stack spacing={1}>
            <TextField
              multiline
              fullWidth
              size={"small"}
              value={draft}
              inputProps={{ "aria-label": "Edit post text" }}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Stack direction={"row"} spacing={1}>
              <Button
                size={"small"}
                variant={"contained"}
                aria-label={"Save edit"}
                disabled={draft.trim().length === 0 || busy}
                onClick={saveEdit}
              >
                Save
              </Button>
              <Button
                size={"small"}
                aria-label={"Cancel edit"}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </Stack>
          </Stack>
        ) : (
          <>
            {post.text && <MarkdownRenderer markdown={post.text} />}
            {post.imagePaths.length > 0 && (
              <ChatPostImages paths={post.imagePaths} />
            )}
            {post.roll && <ChatRollPost post={{ ...post, roll: post.roll }} />}
          </>
        )}
        {(canEdit || showDelete) && !editing && (
          <Stack direction={"row"} spacing={1} sx={{ pt: 0.5 }}>
            {confirmingDelete ? (
              <>
                <Typography
                  variant={"caption"}
                  color={"text.secondary"}
                  sx={{ alignSelf: "center" }}
                >
                  Delete this post?
                </Typography>
                <Button
                  size={"small"}
                  color={"error"}
                  aria-label={"Confirm delete"}
                  disabled={busy}
                  onClick={confirmDelete}
                >
                  Delete
                </Button>
                <Button
                  size={"small"}
                  aria-label={"Cancel delete"}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <>
                {canEdit && (
                  <Button
                    size={"small"}
                    aria-label={"Edit post"}
                    onClick={startEdit}
                  >
                    Edit
                  </Button>
                )}
                {showDelete && (
                  <Button
                    size={"small"}
                    aria-label={"Delete post"}
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete
                  </Button>
                )}
              </>
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
