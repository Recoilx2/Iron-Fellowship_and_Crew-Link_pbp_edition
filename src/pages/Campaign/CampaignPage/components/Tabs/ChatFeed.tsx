import { useEffect, useLayoutEffect, useRef } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useStore } from "stores/store";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import type { PostWithId } from "api-calls/chat/listenToChannelPosts";
import { MarkdownRenderer } from "components/shared/MarkdownRenderer";
import { PortraitAvatar } from "components/features/characters/PortraitAvatar/PortraitAvatar";
import { UserAvatar } from "components/shared/UserAvatar";
import { ChatPostImages } from "./ChatPostImages";
import type { CharacterDocument } from "api-calls/character/_character.type";

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

/**
 * The channel's flat feed (spec #9, prototype variant D): avatar, name
 * line, time, formatted text. In IC channels the name line leads with the
 * character, then the player; in OOC channels it leads with the player's
 * display name, then their character. GMs carry a GM tag. Older posts page
 * in from the top; new posts arrive live at the bottom.
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
  const userMap = useStore((store) => store.users.userMap);
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
          characterMap={characterMap}
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
  characterMap: Record<string, CharacterDocument>;
  gmIds: string[];
  userMap: Record<string, { doc?: { displayName: string } } | undefined>;
}) {
  const { post, channel, characterMap, gmIds, userMap } = props;
  const character =
    post.speakerCharacterId != null
      ? characterMap[post.speakerCharacterId]
      : undefined;
  const authorName =
    userMap[post.authorId]?.doc?.displayName ?? "Someone";
  const isGM = gmIds.includes(post.authorId);

  // IC leads with the character, then the player; OOC leads with the
  // player's display name, then their character beside it.
  const title =
    channel.kind === "IC" ? (character?.name ?? authorName) : authorName;
  const subtitle =
    channel.kind === "IC"
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
        </Stack>
        <MarkdownRenderer markdown={post.text} />
        {post.imagePaths.length > 0 && (
          <ChatPostImages paths={post.imagePaths} />
        )}
      </Box>
    </Stack>
  );
}
