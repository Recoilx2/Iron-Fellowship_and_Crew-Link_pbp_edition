import { afterEach, describe, expect, it, vi } from "vitest";

import { listenToCampaignChannelMembers } from "api-calls/chat/listenToCampaignChannelMembers";
import {
  CHAT_CHANNEL_MEMBERS_TABLE,
  CHAT_CHANNELS_TABLE,
  type ChannelMemberRow,
} from "api-calls/chat/_getRef";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedClient = vi.mocked(getSupabaseClient);

type StatusCallback = (status: string, error?: unknown) => void;

// Seam under test: the roster listener's live source. The roster table
// left the realtime publication (#117: its DELETEs skipped row-level
// security), so the listener re-fetches on every channel change instead
// of streaming the roster rows themselves. The channel and the roster
// table are stubs; the shared refresh-on-signal loop is covered by its
// own tests.
function setUpClient() {
  const filters: unknown[] = [];
  const bindings: Array<{ type: string; cb: (payload: unknown) => void }> =
    [];
  const subscribeCbs: StatusCallback[] = [];
  let rows: ChannelMemberRow[] = [
    { channel_id: "channel-1", user_id: "player-1", created_at: "2026-11-12T00:00:01Z" },
  ];
  const channel = {
    on: (type: string, filter: unknown, cb: (payload: unknown) => void) => {
      filters.push(filter);
      bindings.push({ type, cb });
      return channel;
    },
    subscribe: (cb: StatusCallback) => {
      subscribeCbs.push(cb);
      return channel;
    },
  };
  mockedClient.mockReturnValue({
    channel: () => channel,
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: table === CHAT_CHANNEL_MEMBERS_TABLE ? rows : [],
            error: null,
          }),
      }),
    }),
    removeChannel: () => Promise.resolve("ok"),
  } as never);
  return {
    filters,
    fireChannelBump: () => {
      for (const binding of bindings) {
        if (binding.type === "postgres_changes") {
          binding.cb({
            eventType: "UPDATE",
            new: { id: "channel-1" },
            old: {},
          });
        }
      }
    },
    fireSubscribed: () => {
      for (const cb of subscribeCbs.splice(0)) {
        cb("SUBSCRIBED");
      }
    },
    setRows: (next: ChannelMemberRow[]) => {
      rows = next;
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("chat channel roster listener", () => {
  const stops: Array<() => void> = [];

  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.clearAllMocks();
  });

  function subscribe(onMembers: (rows: ChannelMemberRow[]) => void) {
    const onLoaded = vi.fn();
    const onError = vi.fn();
    stops.push(
      listenToCampaignChannelMembers(
        "campaign-1",
        { onMembers, onLoaded },
        onError
      )
    );
    return { onError };
  }

  it("binds the campaign's channels, not the unpublished roster table", () => {
    const client = setUpClient();
    subscribe(() => {});
    client.fireSubscribed();

    const tables = client.filters.map(
      (filter) => (filter as { table?: unknown }).table
    );
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toContain(CHAT_CHANNELS_TABLE);
    expect(tables).not.toContain(CHAT_CHANNEL_MEMBERS_TABLE);
  });

  it("re-fetches the roster when a channel bumps", async () => {
    const client = setUpClient();
    const seen: ChannelMemberRow[][] = [];
    const { onError } = subscribe((rows) => seen.push(rows));
    client.fireSubscribed();
    await flush();
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0].map((row) => row.user_id)).toEqual(["player-1"]);

    // The GM adds another member: the roster write bumps the channel, the
    // bump re-reads the roster, and the new member arrives live.
    client.setRows([
      { channel_id: "channel-1", user_id: "player-1", created_at: "2026-11-12T00:00:01Z" },
      { channel_id: "channel-1", user_id: "player-2", created_at: "2026-11-12T00:00:02Z" },
    ]);
    client.fireChannelBump();
    await flush();
    await flush();

    expect(seen.at(-1)?.map((row) => row.user_id).sort()).toEqual([
      "player-1",
      "player-2",
    ]);
    expect(onError).not.toHaveBeenCalled();
  });
});
