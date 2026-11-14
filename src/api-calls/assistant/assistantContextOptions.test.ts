import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { fetchAssistantContextOptions } from "api-calls/assistant/assistantContextOptions";

vi.mock("config/supabase.config");

// Seam under test: the Context tab's option lists. One call returns the
// campaign's world, the outline's presence, every world entry, note and
// channel the GM can read (the access rules filter; the client never
// does), with the outline kept out of the notes list because it has its
// own checkbox.
const tables: Record<string, Array<Record<string, unknown>>> = {};

function chainFor(rows: Array<Record<string, unknown>>) {
  const query: Record<string, unknown> = {};
  query.eq = () => query;
  query.then = (resolve: (value: unknown) => void) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return query;
}

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  tables.campaigns = [{ id: "campaign-1", world_id: "world-1" }];
  tables.campaign_notes = [
    { id: "outline-1", title: "Campaign outline", kind: "outline" },
    { id: "note-1", title: "Session idea", kind: "note" },
  ];
  tables.world_lore = [{ id: "lore-1", name: "Old Vault" }];
  tables.world_npcs = [{ id: "npc-1", name: "Keeper" }];
  tables.world_locations = [{ id: "loc-1", name: "Vault" }];
  tables.chat_channels = [
    { id: "ch-1", name: "In-character", visibility: "public" },
    { id: "dm-1", name: "Quiet word", visibility: "dm" },
  ];
  mockedGetSupabaseClient.mockReturnValue({
    from: (table: string) => ({
      select: () => chainFor(tables[table] ?? []),
    }),
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("fetchAssistantContextOptions", () => {
  it("lists the world entries, notes and channels the GM can read", async () => {
    const options = await fetchAssistantContextOptions({
      campaignId: "campaign-1",
    });

    expect(options.worldId).toBe("world-1");
    expect(options.outlineAvailable).toBe(true);
    expect(options.lore).toEqual([{ id: "lore-1", name: "Old Vault" }]);
    expect(options.npcs).toEqual([{ id: "npc-1", name: "Keeper" }]);
    expect(options.locations).toEqual([{ id: "loc-1", name: "Vault" }]);
    expect(options.notes).toEqual([{ id: "note-1", title: "Session idea" }]);
    expect(options.channels.map((channel) => channel.id)).toEqual([
      "ch-1",
      "dm-1",
    ]);
  });

  it("reads no world entries when the campaign has no world yet", async () => {
    tables.campaigns = [{ id: "campaign-1", world_id: null }];

    const options = await fetchAssistantContextOptions({
      campaignId: "campaign-1",
    });

    expect(options.worldId).toBeNull();
    expect(options.lore).toEqual([]);
    expect(options.npcs).toEqual([]);
    expect(options.locations).toEqual([]);
    expect(options.notes).toHaveLength(1);
    expect(options.channels).toHaveLength(2);
  });

  it("reports no outline until a GM opens the Outline tab", async () => {
    tables.campaign_notes = [{ id: "note-1", title: "Session idea", kind: "note" }];

    const options = await fetchAssistantContextOptions({
      campaignId: "campaign-1",
    });

    expect(options.outlineAvailable).toBe(false);
    expect(options.notes).toEqual([{ id: "note-1", title: "Session idea" }]);
  });
});
