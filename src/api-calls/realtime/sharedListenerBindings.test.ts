import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Seam under test: which bindings each listener hands to the shared helper.
 * The helper itself is exercised in listenToRows.test.ts; here it is replaced
 * with a spy so one table can pin the whole split from #206: shared data
 * binds only to private broadcasts, owner-only rows only to postgres_changes.
 */
const spies = vi.hoisted(() => {
  const params: Array<{
    channelName: string;
    bindings: Array<{
      type: string;
      topic?: string;
      event?: string;
      optional?: boolean;
    }>;
  }> = [];
  return {
    params,
    listenToRows: vi.fn((value: (typeof params)[number]) => {
      params.push(value);
      return () => {};
    }),
    listenToRowsDeferred: vi.fn(async (build: () => Promise<unknown>) => {
      const value = (await build()) as (typeof params)[number] | null;
      if (value) params.push(value);
      return () => {};
    }),
  };
});

vi.mock("api-calls/realtime/listenToRows", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("api-calls/realtime/listenToRows")>();
  return {
    ...actual,
    listenToRows: spies.listenToRows,
    listenToRowsDeferred: spies.listenToRowsDeferred,
  };
});

vi.mock("config/supabase.config", () => {
  const dataFor = (table: string) => {
    if (table === "campaigns") return [{ id: "campaign-1" }];
    if (table === "assistant_conversations") {
      return [{ campaign_id: "campaign-1" }];
    }
    if (table === "world_notes") return [{ world_id: "world-1" }];
    if (table === "chat_channels") return [{ id: "channel-1" }];
    return [];
  };
  const query = (table: string) => {
    const result = () => Promise.resolve({ data: dataFor(table), error: null });
    // Both `.select()` (campaigns) and `.select(...).eq(...)` (world notes,
    // conversations, channels) are awaited by the topic lookups.
    return {
      select: () => query(table),
      eq: result,
      then: (resolve: (value: unknown) => unknown) => result().then(resolve),
    };
  };
  return {
    getSupabaseClient: () => ({
      from: query,
      channel: () => ({
        on: () => {},
        subscribe: () => {},
        removeChannel: () => {},
      }),
      removeChannel: () => Promise.resolve("ok"),
    }),
  };
});

import { listenToAssets } from "api-calls/assets/listenToAssets";
import { listenToConversations } from "api-calls/assistant/listenToConversations";
import { listenToMessages } from "api-calls/assistant/listenToMessages";
import { listenToOutlineVersions } from "api-calls/assistant/listenToOutlineVersions";
import { listenToUsersCampaigns } from "api-calls/campaign/listenToUsersCampaigns";
import { listenToSettings } from "api-calls/character-campaign-settings/listenToSettings";
import { listenToCharacter } from "api-calls/character/listenToCharacter";
import { listenToUsersCharacters } from "api-calls/character/listenToUsersCharacters";
import { listenToCampaignChannelMembers } from "api-calls/chat/listenToCampaignChannelMembers";
import { listenToCampaignChannels } from "api-calls/chat/listenToCampaignChannels";
import {
  listenToCampaignRollPosts,
} from "api-calls/chat/listenToCampaignRollPosts";
import { listenToChannelPosts } from "api-calls/chat/listenToChannelPosts";
import { listenToLogs } from "api-calls/game-log/listenToLogs";
import { listenToHomebrewCollections } from "api-calls/homebrew/listenToHomebrewCollections";
import { listenToNoteContent } from "api-calls/notes/listenToNoteContent";
import { listenToNotes } from "api-calls/notes/listenToNotes";
import { listenToAccessibilitySettings } from "api-calls/user/settings/listenToAccessibilitySettings";
import { listenToOracleSettings } from "api-calls/user/settings/listenToOracleSettings";
import { listenToLocationGMProperties } from "api-calls/world/locations/listenToLocationGMProperties";
import { listenToLocationNotes } from "api-calls/world/locations/listenToLocationNotes";
import { listenToLocations } from "api-calls/world/locations/listenToLocations";
import { listenToLoreDocuments } from "api-calls/world/lore/listenToLoreDocuments";
import { listenToNPCGMProperties } from "api-calls/world/npcs/listenToNPCGMProperties";
import { listenToNPCs } from "api-calls/world/npcs/listenToNPCs";
import { listenToUsersWorlds } from "api-calls/world/listenToUsersWorlds";
import { listenToWorld } from "api-calls/world/listenToWorld";
import { listenToWorldNoteContent } from "api-calls/world/worldNotes";
import { listenToProgressTracks } from "api-calls/tracks/listenToProgressTracks";

const noop = () => {};
const handler = {
  onDocChange: noop,
  onDocRemove: noop,
  onLoaded: noop,
};

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

function topicsOf(params: (typeof spies.params)[number]): string[] {
  return params.bindings
    .filter((binding) => binding.type === "broadcast")
    .map((binding) => binding.topic ?? params.channelName);
}

function expectBroadcastOnly(
  params: (typeof spies.params)[number],
  expected: string[]
) {
  expect(params.bindings.length).toBeGreaterThan(0);
  expect(params.bindings.every((binding) => binding.type === "broadcast")).toBe(
    true
  );
  const topics = topicsOf(params);
  for (const fragment of expected) {
    expect(topics.some((topic) => topic.startsWith(fragment))).toBe(true);
  }
}

beforeEach(() => {
  spies.params.splice(0);
  spies.listenToRows.mockClear();
  spies.listenToRowsDeferred.mockClear();
});

describe("shared-data listeners use broadcasts only", () => {
  it("notes: GMs get both campaign topics, players only the shared one", async () => {
    listenToNotes("campaign-1", undefined, noop, noop, true);
    listenToNoteContent("campaign-1", undefined, "note-1", noop, noop, true);
    await settle();
    expect(spies.params).toHaveLength(2);
    for (const params of spies.params) {
      expectBroadcastOnly(params, [
        "campaign-shared:campaign-1:notes",
        "campaign-gm:campaign-1:notes",
      ]);
    }

    spies.params.splice(0);
    listenToNotes("campaign-1", undefined, noop, noop);
    listenToNoteContent("campaign-1", undefined, "note-1", noop, noop);
    await settle();
    expect(spies.params).toHaveLength(2);
    for (const params of spies.params) {
      expectBroadcastOnly(params, ["campaign-shared:campaign-1:notes"]);
      expect(
        topicsOf(params).some((topic) => topic.startsWith("campaign-gm:"))
      ).toBe(false);
    }
  });

  it("world: worlds, locations, lore, NPCs, notes and GM details", async () => {
    listenToUsersWorlds("u1", handler, noop, true);
    listenToWorld("world-1", noop, noop, true);
    listenToLocations("world-1", noop, noop, noop, noop, true);
    listenToLoreDocuments("world-1", noop, noop, noop, noop, true);
    listenToNPCs("world-1", noop, noop, noop, noop, true);
    listenToLocationGMProperties("world-1", "location-1", noop, noop);
    listenToNPCGMProperties("world-1", "npc-1", noop, noop);
    listenToWorldNoteContent("note-1", noop, noop, true);
    listenToLocationNotes("world-1", "location-1", noop, noop, true);
    await settle();

    expect(spies.params).toHaveLength(9);
    for (const params of spies.params) {
      expectBroadcastOnly(params, ["campaign-gm:campaign-1:"]);
      // GM-detail listeners intentionally have no shared-family topic.
      if (
        !params.channelName.startsWith("world-location:") &&
        !params.channelName.startsWith("world-npc:")
      ) {
        expectBroadcastOnly(params, ["campaign-shared:campaign-1:"]);
      }
    }
    const families = spies.params.map((params) => topicsOf(params).join(" "));
    expect(families.some((topics) => topics.includes(":locations"))).toBe(
      true
    );
    expect(families.some((topics) => topics.includes(":lore"))).toBe(true);
    expect(families.some((topics) => topics.includes(":npcs"))).toBe(true);
    expect(
      families.some((topics) => topics.includes("campaign-gm:campaign-1:world"))
    ).toBe(true);
  });

  it("players never join a denied campaign-gm topic", async () => {
    listenToUsersWorlds("u1", handler, noop);
    listenToWorld("world-1", noop, noop);
    listenToLocations("world-1", noop, noop, noop, noop);
    listenToLoreDocuments("world-1", noop, noop, noop, noop);
    listenToNPCs("world-1", noop, noop, noop, noop);
    listenToWorldNoteContent("note-1", noop, noop);
    listenToLocationNotes("world-1", "location-1", noop, noop);
    await settle();

    expect(spies.params).toHaveLength(7);
    for (const params of spies.params) {
      expectBroadcastOnly(params, ["campaign-shared:campaign-1:"]);
      expect(
        topicsOf(params).some((topic) => topic.startsWith("campaign-gm:"))
      ).toBe(false);
    }
  });

  it("assistant: conversations, messages and outline versions use the GM topic", async () => {
    listenToConversations("campaign-1", { onConversations: noop, onLoaded: noop }, noop);
    listenToMessages("conversation-1", { onMessages: noop, onLoaded: noop }, noop);
    listenToOutlineVersions("campaign-1", { onVersions: noop, onLoaded: noop }, noop);
    await settle();

    expect(spies.params).toHaveLength(3);
    for (const params of spies.params) {
      expectBroadcastOnly(params, ["campaign-gm:campaign-1:assistant"]);
      expect(topicsOf(params).some((topic) => topic.startsWith("campaign-shared"))).toBe(
        false
      );
      expect(params.bindings.every((binding) => binding.optional === true)).toBe(
        true
      );
    }
  });

  it("chat: channels, roster, posts and roll posts use channel topics", async () => {
    listenToCampaignChannels("campaign-1", { onChannels: noop, onLoaded: noop }, noop);
    listenToCampaignChannelMembers(
      "campaign-1",
      { onMembers: noop, onLoaded: noop },
      noop
    );
    listenToChannelPosts(
      "channel-1",
      30,
      { onPosts: noop, onHasOlder: noop, onLoaded: noop },
      noop
    );
    listenToCampaignRollPosts({
      campaignId: "campaign-1",
      totalLogsToLoad: 10,
      isGM: false,
      updateLog: noop,
      removeLog: noop,
      onError: noop,
    });
    await settle();

    expect(spies.params).toHaveLength(4);
    const forName = (name: string) => {
      const params = spies.params.find((p) => p.channelName === name);
      expect(params).toBeTruthy();
      return params as (typeof spies.params)[number];
    };
    // Channels, roster and roll log also watch the campaign refresh topic;
    // a single channel's posts only need the channel topic.
    for (const name of [
      "campaign-channels:campaign-1",
      "campaign-channel-members:campaign-1",
      "campaign:campaign-1:rolls",
    ]) {
      expectBroadcastOnly(forName(name), [
        "channel-shared:channel-1",
        "campaign-shared:campaign-1:chat",
      ]);
    }
    expectBroadcastOnly(forName("channel-posts:channel-1"), [
      "channel-shared:channel-1",
    ]);
  });
});

describe("owner-only listeners stay on postgres_changes", () => {
  it("pins every owner/public-only family named in #206", () => {
    listenToAccessibilitySettings("u1", noop);
    listenToOracleSettings("u1", noop, noop);
    listenToUsersCharacters("u1", handler, noop);
    listenToUsersCampaigns("u1", handler, noop);
    listenToAssets(undefined, "campaign-1", noop, noop);
    listenToAssets("character-1", undefined, noop, noop);
    listenToHomebrewCollections("u1", noop, noop, noop, noop);
    listenToSettings("campaign-1", undefined, noop, noop);
    listenToSettings(undefined, "character-1", noop, noop);
    listenToCharacter("character-1", noop, noop);
    listenToLogs({
      isGM: false,
      campaignId: "campaign-1",
      totalLogsToLoad: 10,
      updateLog: noop,
      removeLog: noop,
      onError: noop,
    });
    listenToLogs({
      isGM: false,
      characterId: "character-1",
      totalLogsToLoad: 10,
      updateLog: noop,
      removeLog: noop,
      onError: noop,
    });
    listenToProgressTracks("campaign-1", undefined, "active", noop, noop, noop);
    listenToProgressTracks(undefined, "character-1", "active", noop, noop, noop);
    listenToNotes(undefined, "character-1", noop, noop);
    listenToNoteContent(undefined, "character-1", "note-1", noop, noop);

    expect(spies.params.length).toBeGreaterThanOrEqual(16);
    for (const params of spies.params) {
      expect(params.bindings.length).toBeGreaterThan(0);
      expect(
        params.bindings.every((binding) => binding.type === "postgres_changes")
      ).toBe(true);
    }
  });
});
