import { beforeEach, describe, expect, it, vi } from "vitest";

import { listenToCampaignChannels } from "api-calls/chat/listenToCampaignChannels";
import { listenToCampaignChannelMembers } from "api-calls/chat/listenToCampaignChannelMembers";
import { defaultChatSlice } from "stores/chat/chat.slice.default";
import { createChatSlice } from "stores/chat/chat.slice";
import type { ChatSlice, ChatSliceData } from "stores/chat/chat.slice.type";
import type { IStore } from "stores/store.type";

vi.mock("api-calls/chat/listenToCampaignChannels");
vi.mock("api-calls/chat/listenToCampaignChannelMembers");

const mockedListen = vi.mocked(listenToCampaignChannels);
const mockedListenMembers = vi.mocked(listenToCampaignChannelMembers);

// Seam under test: the chat slice turns the channel listener's rows into the
// tab's channel list and keeps the open channel selected. The listener
// itself is covered by the live access-rule tests; here it is a stub.
type CapturedHandler = {
  onChannels: (channels: never[]) => void;
  onLoaded: () => void;
};
type CapturedMembersHandler = {
  onMembers: (rows: never[]) => void;
  onLoaded: () => void;
};
type CapturedFail = (error: unknown) => void;

function setUpSlice(campaignId: string | undefined = "campaign-1") {
  const draft: { chat: ChatSliceData } = {
    chat: { ...defaultChatSlice },
  };
  const set = (fn: (store: { chat: ChatSliceData }) => void) => {
    fn(draft);
  };
  const get = () =>
    ({
      campaigns: { currentCampaign: { currentCampaignId: campaignId } },
    }) as unknown as IStore;
  const slice = createChatSlice(
    set as never,
    get as never,
    undefined as never
  ) as ChatSlice;
  return { slice, draft: () => draft.chat };
}

describe("chat slice channel list", () => {
  let captured: CapturedHandler | undefined;
  let capturedFail: CapturedFail | undefined;
  let capturedMembers: CapturedMembersHandler | undefined;

  beforeEach(() => {
    captured = undefined;
    capturedFail = undefined;
    capturedMembers = undefined;
    mockedListen.mockClear();
    mockedListen.mockImplementation((_campaignId, handler, fail) => {
      captured = handler as unknown as CapturedHandler;
      capturedFail = fail as unknown as CapturedFail;
      return () => {};
    });
    mockedListenMembers.mockClear();
    mockedListenMembers.mockImplementation((_campaignId, handler) => {
      capturedMembers = handler as unknown as CapturedMembersHandler;
      return () => {};
    });
  });

  it("loads the campaign channels and opens the starting IC channel", () => {
    const { slice, draft } = setUpSlice();
    slice.subscribe("campaign-1");
    expect(mockedListen).toHaveBeenCalledWith(
      "campaign-1",
      expect.anything(),
      expect.anything()
    );

    captured?.onChannels([
      {
        id: "ooc",
        name: "Out of character",
        kind: "OOC",
        isStarting: true,
        archived: false,
      },
      {
        id: "ic",
        name: "In character",
        kind: "IC",
        isStarting: true,
        archived: false,
      },
    ] as never[]);
    captured?.onLoaded();

    expect(draft().loading).toBe(false);
    expect(draft().channels.map((channel) => channel.id)).toEqual([
      "ooc",
      "ic",
    ]);
    expect(draft().openChannelId).toBe("ic");
  });

  it("keeps the chosen channel across later updates", () => {
    const { slice, draft } = setUpSlice();
    slice.subscribe("campaign-1");

    captured?.onChannels([
      {
        id: "ic",
        name: "In character",
        kind: "IC",
        isStarting: true,
        archived: false,
      },
      {
        id: "side",
        name: "Side scene",
        kind: "OOC",
        isStarting: false,
        archived: false,
      },
    ] as never[]);
    slice.setOpenChannelId("side");
    captured?.onChannels([
      {
        id: "ic",
        name: "In character",
        kind: "IC",
        isStarting: true,
        archived: false,
      },
      {
        id: "side",
        name: "Harbor side scene",
        kind: "OOC",
        isStarting: false,
        archived: false,
      },
    ] as never[]);

    expect(draft().openChannelId).toBe("side");
    expect(
      draft().channels.find((channel) => channel.id === "side")?.name
    ).toBe("Harbor side scene");
  });

  it("reports load errors", () => {
    const { slice, draft } = setUpSlice();
    slice.subscribe("campaign-1");
    capturedFail?.(new Error("boom"));
    expect(draft().loading).toBe(false);
    expect(draft().error).toBe("Failed to load channels.");
  });

  it("stores the visible roster keyed by channel", () => {
    const { slice, draft } = setUpSlice();
    slice.subscribe("campaign-1");
    capturedMembers?.onMembers([
      {
        channel_id: "quest",
        user_id: "player-2",
        created_at: "2026-11-13T12:00:00.000Z",
      },
      {
        channel_id: "quest",
        user_id: "player-1",
        created_at: "2026-11-13T12:00:00.000Z",
      },
      {
        channel_id: "dm-1",
        user_id: "player-1",
        created_at: "2026-11-13T12:00:00.000Z",
      },
    ] as never[]);
    capturedMembers?.onLoaded();
    expect(draft().membersByChannel).toEqual({
      quest: ["player-1", "player-2"],
      "dm-1": ["player-1"],
    });
  });

  it("does nothing without a campaign", () => {
    const { slice, draft } = setUpSlice(undefined);
    const unsubscribe = slice.subscribe(undefined);
    expect(mockedListen).not.toHaveBeenCalled();
    expect(mockedListenMembers).not.toHaveBeenCalled();
    expect(draft().loading).toBe(false);
    unsubscribe();
  });
});
