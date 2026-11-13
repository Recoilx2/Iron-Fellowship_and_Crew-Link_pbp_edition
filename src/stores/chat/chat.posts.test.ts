import { beforeEach, describe, expect, it, vi } from "vitest";

import { listenToChannelPosts } from "api-calls/chat/listenToChannelPosts";
import {
  CHAT_POST_MAX_WINDOW,
  CHAT_POST_PAGE_SIZE,
} from "api-calls/chat/listenToChannelPosts";
import { defaultChatSlice } from "stores/chat/chat.slice.default";
import { createChatSlice } from "stores/chat/chat.slice";
import type { ChatSlice, ChatSliceData } from "stores/chat/chat.slice.type";
import type { IStore } from "stores/store.type";
import type { PostWithId } from "api-calls/chat/listenToChannelPosts";

vi.mock("api-calls/chat/listenToChannelPosts");
vi.mock("api-calls/chat/listenToCampaignChannels");

const mockedListen = vi.mocked(listenToChannelPosts);

// Seam under test: the chat slice turns the post listener's rows into the
// feed's oldest-first window, pages the window back on scroll, and keeps an
// unsent draft per channel. The listener itself is covered by the live
// access-rule tests; here it is a stub.
type CapturedHandler = {
  onPosts: (posts: PostWithId[]) => void;
  onHasOlder: (hasOlder: boolean) => void;
  onLoaded: () => void;
};

function posts(count: number, start = 0): PostWithId[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `post-${start + i}`,
    channelId: "channel-1",
    authorId: "player-1",
    speakerCharacterId: null,
    speakerNpcId: null,
    text: `post ${start + i}`,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(Date.now() + (start + i) * 1000).toISOString(),
  }));
}

function setUpSlice() {
  const chat: ChatSliceData = {
    ...defaultChatSlice,
    channels: [],
    postsByChannel: {},
    hasOlderByChannel: {},
    drafts: {},
  };
  const set = (fn: (store: { chat: ChatSliceData }) => void) => {
    fn({ chat });
  };
  const announce = vi.fn();
  const get = () =>
    ({ chat, appState: { announce } }) as unknown as IStore;
  const slice = createChatSlice(
    set as never,
    get as never,
    undefined as never
  ) as ChatSlice;
  return { slice, draft: () => chat, announce };
}

describe("chat slice posts", () => {
  let captured: CapturedHandler | undefined;
  let capturedLimit = 0;
  const seenLimits: number[] = [];

  beforeEach(() => {
    captured = undefined;
    capturedLimit = 0;
    seenLimits.length = 0;
    mockedListen.mockClear();
    mockedListen.mockImplementation((_channelId, limit, handler) => {
      captured = handler as unknown as CapturedHandler;
      capturedLimit = limit;
      seenLimits.push(limit);
      return () => {};
    });
  });

  it("loads the latest page oldest-first with its has-older flag", () => {
    const { slice, draft } = setUpSlice();
    slice.subscribeToPosts("channel-1");
    expect(mockedListen).toHaveBeenCalledWith(
      "channel-1",
      CHAT_POST_PAGE_SIZE,
      expect.anything(),
      expect.anything()
    );

    captured?.onHasOlder(true);
    captured?.onPosts(posts(3));
    captured?.onLoaded();

    expect(draft().postsLoading).toBe(false);
    expect(draft().postsByChannel["channel-1"]?.map((post) => post.id)).toEqual([
      "post-0",
      "post-1",
      "post-2",
    ]);
    expect(draft().hasOlderByChannel["channel-1"]).toBe(true);
  });

  it("pages the window back on scroll, bounded by the max window", () => {
    const { slice } = setUpSlice();
    slice.subscribeToPosts("channel-9");
    captured?.onPosts(posts(CHAT_POST_PAGE_SIZE));
    captured?.onLoaded();

    slice.loadOlderPosts("channel-9");
    expect(capturedLimit).toBe(CHAT_POST_PAGE_SIZE * 2);

    // Paging past the cap stays at the cap instead of re-fetching more.
    for (let i = 0; i < 20; i += 1) {
      slice.loadOlderPosts("channel-9");
    }
    expect(capturedLimit).toBe(CHAT_POST_MAX_WINDOW);
    expect(seenLimits.every((limit) => limit <= CHAT_POST_MAX_WINDOW)).toBe(
      true
    );
  });

  it("keeps one window per channel and stops the old subscription", () => {
    const { slice, draft } = setUpSlice();
    const firstStop = vi.fn();
    mockedListen.mockImplementationOnce((_channelId, _limit, handler) => {
      captured = handler as unknown as CapturedHandler;
      return firstStop;
    });

    slice.subscribeToPosts("channel-1");
    captured?.onPosts(posts(2));
    captured?.onLoaded();

    slice.subscribeToPosts("channel-2");
    expect(firstStop).toHaveBeenCalled();
    captured?.onPosts(posts(1));
    captured?.onLoaded();

    // Each channel keeps its own window: switching back needs no reload.
    expect(draft().postsByChannel["channel-1"]).toHaveLength(2);
    expect(draft().postsByChannel["channel-2"]).toHaveLength(1);
  });

  it("keeps an unsent draft per channel", () => {
    const { slice, draft } = setUpSlice();
    slice.setDraft("channel-1", "half a post");
    slice.setDraft("channel-2", "other channel draft");
    expect(draft().drafts["channel-1"]).toBe("half a post");
    expect(draft().drafts["channel-2"]).toBe("other channel draft");

    slice.setDraft("channel-1", "");
    expect(draft().drafts["channel-2"]).toBe("other channel draft");
  });

  it("reports post load errors", () => {
    const { slice, draft } = setUpSlice();
    const fail = vi.mocked(listenToChannelPosts).mock.calls;
    void fail;
    slice.subscribeToPosts("channel-1");
    const onError = mockedListen.mock.calls[0][3] as (e: unknown) => void;
    onError(new Error("boom"));
    expect(draft().postsLoading).toBe(false);
    expect(draft().postsError).toBe("Failed to load posts.");
  });

  it("does nothing without a channel", () => {
    const { slice, draft } = setUpSlice();
    const unsubscribe = slice.subscribeToPosts(undefined);
    expect(mockedListen).not.toHaveBeenCalled();
    expect(draft().postsLoading).toBe(false);
    unsubscribe();
  });

  it("announces new arrivals but not the first page or older pages", () => {
    const { slice, draft, announce } = setUpSlice();
    draft().channels = [
      {
        id: "channel-1",
        name: "In character",
        kind: "IC",
        isStarting: true,
        archived: false,
      },
    ];
    slice.subscribeToPosts("channel-1");

    // The first snapshot only fills the feed: nothing to announce.
    captured?.onHasOlder(false);
    captured?.onPosts(posts(2));
    captured?.onLoaded();
    expect(announce).not.toHaveBeenCalled();

    // A live arrival is announced with its channel and text.
    captured?.onPosts([
      ...posts(2),
      {
        id: "post-2",
        channelId: "channel-1",
        authorId: "player-1",
        speakerCharacterId: null,
    speakerNpcId: null,
        text: "A new post arrives.",
        createdAt: new Date(Date.now() + 60_000).toISOString(),
        editedAt: null,
        deletedAt: null,
      },
    ]);
    expect(announce).toHaveBeenCalledWith(
      "New post in # In character: A new post arrives."
    );

    // Paging back re-emits the window with older posts only: silence.
    announce.mockClear();
    captured?.onPosts([
      {
        id: "post-older",
        channelId: "channel-1",
        authorId: "player-1",
        speakerCharacterId: null,
    speakerNpcId: null,
        text: "An older post pages in.",
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
      ...posts(2),
      {
        id: "post-2",
        channelId: "channel-1",
        authorId: "player-1",
        speakerCharacterId: null,
    speakerNpcId: null,
        text: "A new post arrives.",
        createdAt: new Date(Date.now() + 60_000).toISOString(),
        editedAt: null,
        deletedAt: null,
      },
    ]);
    expect(announce).not.toHaveBeenCalled();
  });
});
