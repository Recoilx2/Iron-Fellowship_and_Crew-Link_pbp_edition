/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

const search = vi.fn();
const jumpToPost = vi.fn();

import type { PostWithId } from "api-calls/chat/listenToChannelPosts";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";

const state = { chat: { jumpToPost } };

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock("api-calls/chat/searchCampaignPosts", () => ({
  CHAT_SEARCH_PAGE_SIZE: 20,
  searchCampaignPosts: (...args: unknown[]) => search(...args),
}));

import { ChatPostSearch } from "../ChatPostSearch";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const channels: ChannelWithId[] = [
  {
    id: "ic",
    name: "In character",
    kind: "IC",
    visibility: "public",
    isStarting: true,
    archived: false,
  },
  {
    id: "quest",
    name: "Side quest",
    kind: "IC",
    visibility: "private",
    isStarting: false,
    archived: false,
  },
];

const userMap = {
  "player-1": { doc: { displayName: "Ava" } },
};

function post(n: number, channelId = "ic", text = `needle ${n}`): PostWithId {
  return {
    id: `post-${n}`,
    channelId,
    authorId: "player-1",
    speakerCharacterId: null,
    speakerNpcId: null,
    text,
    imagePaths: [],
    roll: null,
    gmsOnly: false,
    createdAt: new Date(Date.parse("2026-11-27T12:00:00.000Z") + n * 1000).toISOString(),
    editedAt: null,
    deletedAt: null,
  };
}

describe("chat post search dialog", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    document.body.querySelectorAll("[role=dialog]").forEach((node) => node.remove());
    vi.clearAllMocks();
  });

  function render(onClose = () => {}) {
    jumpToPost.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <ChatPostSearch
            open
            onClose={onClose}
            campaignId="campaign-1"
            channels={channels}
            userMap={userMap}
          />
        </ThemeProvider>
      );
    });
  }

  function field(): HTMLInputElement {
    const input = document.body.querySelector(
      'input[aria-label="Search post text"]'
    ) as HTMLInputElement | null;
    if (!input) {
      throw new Error("no search field");
    }
    return input;
  }

  function fill(text: string) {
    const input = field();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function click(name: string) {
    const button = Array.from(document.body.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === name
    );
    if (!button) {
      throw new Error(`no button named ${name}`);
    }
    act(() => button.click());
  }

  it("searches the campaign and shows channel, author, snippet and date", async () => {
    search.mockResolvedValueOnce({ posts: [post(3, "quest")], nextCursor: undefined });
    render();

    const submit = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Search"
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fill("  needle  ");
    await act(async () => submit.click());

    expect(search).toHaveBeenCalledWith({
      campaignId: "campaign-1",
      query: "needle",
      cursor: undefined,
      pageSize: 20,
    });
    expect(document.body.textContent).toContain("# Side quest");
    expect(document.body.textContent).toContain("Ava");
    expect(document.body.textContent).toContain("needle 3");
    expect(document.body.textContent).toContain("2026");
  });

  it("jumps to a result and closes the dialog", async () => {
    search.mockResolvedValueOnce({ posts: [post(3)], nextCursor: undefined });
    const onClose = vi.fn();
    render(onClose);

    fill("needle");
    await act(async () => click("Search"));
    const result = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("needle 3")
    );
    expect(result).toBeTruthy();
    await act(async () => result?.click());

    expect(jumpToPost).toHaveBeenCalledWith({
      channelId: "ic",
      id: "post-3",
      createdAt: post(3).createdAt,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("pages forward and back without losing the phrase", async () => {
    const cursor = { createdAt: post(2).createdAt, id: "post-2" };
    search
      .mockResolvedValueOnce({ posts: [post(3)], nextCursor: cursor })
      .mockResolvedValueOnce({ posts: [post(1)], nextCursor: undefined })
      .mockResolvedValueOnce({ posts: [post(3)], nextCursor: cursor });
    render();

    fill("needle");
    await act(async () => click("Search"));
    await act(async () => click("Next"));
    expect(search).toHaveBeenLastCalledWith({
      campaignId: "campaign-1",
      query: "needle",
      cursor,
      pageSize: 20,
    });
    expect(document.body.textContent).toContain("needle 1");

    await act(async () => click("Back"));
    expect(search).toHaveBeenLastCalledWith({
      campaignId: "campaign-1",
      query: "needle",
      cursor: undefined,
      pageSize: 20,
    });
    expect(document.body.textContent).toContain("needle 3");
  });

  it("says when a search found nothing", async () => {
    search.mockResolvedValueOnce({ posts: [], nextCursor: undefined });
    render();

    fill("absent");
    await act(async () => click("Search"));

    expect(document.body.textContent).toContain("No posts match that phrase.");
  });
});
