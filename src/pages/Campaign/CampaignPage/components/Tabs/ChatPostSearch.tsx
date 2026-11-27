import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useStore } from "stores/store";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import type { PostWithId } from "api-calls/chat/listenToChannelPosts";
import {
  CHAT_SEARCH_PAGE_SIZE,
  searchCampaignPosts,
  type SearchCursor,
} from "api-calls/chat/searchCampaignPosts";
import { logError } from "functions/errorReference";

/**
 * Campaign-wide post search dialog (ticket #202). Search is one database
 * call per page: the server applies the post access rules, so results never
 * include a private channel, DM or GM-only post the reader may not see.
 * Picking a result hands the post back to ChatTab, which asks the store to
 * load its context and focus the feed before closing this dialog.
 */
export interface ChatPostSearchProps {
  open: boolean;
  onClose: () => void;
  campaignId?: string;
  channels: ChannelWithId[];
  userMap: Record<string, { doc?: { displayName: string } } | undefined>;
}

function resultLabel(
  post: PostWithId,
  channels: ChannelWithId[],
  userMap: ChatPostSearchProps["userMap"]
): { channel: string; author: string; snippet: string } {
  const channel = channels.find((row) => row.id === post.channelId);
  const channelName = channel
    ? `${channel.visibility === "dm" ? "@" : "#"} ${channel.name}`
    : "channel";
  const snippet =
    post.text.trim() ||
    (post.roll
      ? "Roll"
      : post.imagePaths.length > 0
        ? `${post.imagePaths.length} image${post.imagePaths.length === 1 ? "" : "s"}`
        : "post deleted");
  return {
    channel: channelName,
    author: userMap[post.authorId]?.doc?.displayName ?? "Someone",
    snippet: snippet.length > 180 ? `${snippet.slice(0, 180)}…` : snippet,
  };
}

export function ChatPostSearch(props: ChatPostSearchProps) {
  const { open, onClose, campaignId, channels, userMap } = props;
  const jumpToPost = useStore((store) => store.chat.jumpToPost);
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [posts, setPosts] = useState<PostWithId[]>([]);
  const [nextCursor, setNextCursor] = useState<SearchCursor | undefined>();
  // One entry per visited page; index 0 is the first page. Back re-runs the
  // query for the previous cursor instead of caching page bodies.
  const [cursors, setCursors] = useState<Array<SearchCursor | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const requestRef = useRef(0);

  useEffect(() => {
    // Reject in-flight replies when the dialog closes or reopens, so a slow
    // old search cannot overwrite a fresh one.
    requestRef.current += 1;
    setQuery("");
    setSearchedQuery("");
    setPosts([]);
    setNextCursor(undefined);
    setCursors([undefined]);
    setPageIndex(0);
    setBusy(false);
    setError(undefined);
  }, [open]);

  const runSearch = (phrase: string, cursor?: SearchCursor) => {
    if (!campaignId || phrase.trim().length === 0) {
      return;
    }
    const request = ++requestRef.current;
    setBusy(true);
    setError(undefined);
    searchCampaignPosts({
      campaignId,
      query: phrase,
      cursor,
      pageSize: CHAT_SEARCH_PAGE_SIZE,
    })
      .then((result) => {
        if (request !== requestRef.current) {
          return;
        }
        setPosts(result.posts);
        setNextCursor(result.nextCursor);
      })
      .catch((failure: unknown) => {
        if (request !== requestRef.current) {
          return;
        }
        logError("ChatPostSearch", failure);
        setPosts([]);
        setNextCursor(undefined);
        setError("Search failed. Please try again.");
      })
      .finally(() => {
        if (request === requestRef.current) {
          setBusy(false);
        }
      });
  };

  const submit = () => {
    const phrase = query.trim();
    if (!phrase || !campaignId) {
      return;
    }
    setSearchedQuery(phrase);
    setCursors([undefined]);
    setPageIndex(0);
    runSearch(phrase);
  };

  const next = () => {
    if (!nextCursor || busy) {
      return;
    }
    const following = [...cursors.slice(0, pageIndex + 1), nextCursor];
    setCursors(following);
    setPageIndex(following.length - 1);
    runSearch(searchedQuery, nextCursor);
  };

  const back = () => {
    if (pageIndex === 0 || busy) {
      return;
    }
    const previous = pageIndex - 1;
    setPageIndex(previous);
    runSearch(searchedQuery, cursors[previous]);
  };

  const openResult = (post: PostWithId) => {
    jumpToPost({
      channelId: post.channelId,
      id: post.id,
      createdAt: post.createdAt,
    }).catch(() => {});
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth={"sm"}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DialogTitle>Search posts</DialogTitle>
        <DialogContent>
          <Stack direction={"row"} spacing={1} sx={{ mb: 1 }}>
            <TextField
              fullWidth
              size={"small"}
              value={query}
              placeholder={"Words from a post"}
              inputProps={{ "aria-label": "Search post text" }}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              type={"submit"}
              variant={"contained"}
              disabled={busy || !campaignId || query.trim().length === 0}
            >
              Search
            </Button>
          </Stack>
          {error && (
            <Typography color={"error"} variant={"body2"}>
              {error}
            </Typography>
          )}
          {!searchedQuery && (
            <Typography variant={"body2"} color={"text.secondary"}>
              Search every channel in this campaign.
            </Typography>
          )}
          {searchedQuery && !busy && posts.length === 0 && !error && (
            <Typography variant={"body2"} color={"text.secondary"}>
              No posts match that phrase.
            </Typography>
          )}
          <Stack spacing={0.5}>
            {posts.map((post) => {
              const label = resultLabel(post, channels, userMap);
              return (
                <Button
                  key={post.id}
                  fullWidth
                  variant={"text"}
                  onClick={() => openResult(post)}
                  sx={{ textAlign: "left", justifyContent: "flex-start" }}
                >
                  <Stack spacing={0.25} sx={{ minWidth: 0, py: 0.5 }}>
                    <Typography variant={"caption"} color={"text.secondary"}>
                      {label.channel} ·{" "}
                      {new Date(post.createdAt).toLocaleString()}
                    </Typography>
                    <Typography variant={"body2"} fontWeight={700}>
                      {label.author}
                    </Typography>
                    <Typography variant={"body2"} noWrap>
                      {label.snippet}
                    </Typography>
                  </Stack>
                </Button>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={back} disabled={busy || pageIndex === 0}>
            Back
          </Button>
          <Button onClick={next} disabled={busy || !nextCursor}>
            Next
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
