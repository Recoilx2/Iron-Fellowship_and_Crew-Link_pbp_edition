import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import {
  constructWorldNoteRowChannelName,
  ensureWorldItemNotes,
} from "api-calls/world/worldNotes";
import { listenToLocationGMNotes } from "api-calls/world/locations/listenToLocationGMNotes";
import { listenToLocationNotes } from "api-calls/world/locations/listenToLocationNotes";
import { encodeNoteContent } from "api-calls/notes/noteContent";

vi.mock("config/supabase.config");

// Seam under test: ensureWorldItemNotes insert plumbing. Inserted
// world_notes rows must carry client-generated UUID ids and the call must
// resolve to those ids without a `.select()` on the insert:
// INSERT...RETURNING on world_notes fails RLS because the world_notes
// SELECT policy re-queries its own table (#74).
const state = {
  existingNotes: [] as Array<{ id: string; gm_only: boolean }>,
  insertedNotes: [] as Array<Record<string, unknown>>,
  failInserts: false,
};

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  state.existingNotes = [];
  state.insertedNotes = [];
  state.failInserts = false;
  mockedGetSupabaseClient.mockReturnValue({
    from: (table: string) => {
      if (table !== "world_notes") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: async () => ({ data: state.existingNotes, error: null }),
        }),
        // No `.select()` on the insert builder on purpose: the fixed code
        // must not call it (PostgREST would send Prefer:
        // return=representation, which world_notes RLS rejects).
        insert: (row: Record<string, unknown>) => {
          if (state.failInserts) {
            throw new Error("duplicate key value");
          }
          state.insertedNotes.push(row);
          return { error: null };
        },
      };
    },
    // The note-ensure path never touches the other clients.
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("ensureWorldItemNotes insert plumbing", () => {
  it("creates both note rows with client-generated ids and resolves to them", async () => {
    const ids = await ensureWorldItemNotes(
      "world-1",
      "location",
      "location-1"
    );

    expect(state.insertedNotes).toHaveLength(2);
    for (const row of state.insertedNotes) {
      expect(row.id).toMatch(UUID_RE);
      expect(row).toMatchObject({
        world_id: "world-1",
        location_id: "location-1",
      });
    }
    const publicRow = state.insertedNotes.find((row) => !row.gm_only);
    const gmRow = state.insertedNotes.find((row) => row.gm_only);
    expect(ids).toEqual({ publicNoteId: publicRow?.id, gmNoteId: gmRow?.id });
  });

  it("returns existing notes without inserting", async () => {
    state.existingNotes = [
      { id: "public-note", gm_only: false },
      { id: "gm-note", gm_only: true },
    ];

    const ids = await ensureWorldItemNotes(
      "world-1",
      "location",
      "location-1"
    );

    expect(ids).toEqual({ publicNoteId: "public-note", gmNoteId: "gm-note" });
    expect(state.insertedNotes).toHaveLength(0);
  });

  it("falls back to the re-read when a concurrent creator wins the race", async () => {
    state.failInserts = true;
    state.existingNotes = [
      { id: "public-note", gm_only: false },
      { id: "gm-note", gm_only: true },
    ];

    const ids = await ensureWorldItemNotes(
      "world-1",
      "location",
      "location-1"
    );

    expect(ids).toEqual({ publicNoteId: "public-note", gmNoteId: "gm-note" });
  });
});

// Seam under test: GM+public note listeners for one item must never alias
// one realtime topic (#83). supabase-js channel() creates-OR-REUSES by
// topic, so two listenToRows on the same topic make the second .on() throw
// ("cannot add postgres_changes callbacks ... after subscribe()").
//
// The fake below reproduces exactly that contract: channels are keyed by
// topic, subscribe() marks the channel joined synchronously (realtime-js
// joinedOnce), and postgres_changes .on() after subscribe throws.
type StatusCallback = (status: string) => void;
type PostgresCallback = (payload: unknown) => void;

interface FakeTopicChannel {
  topic: string;
  joinedOnce: boolean;
  postgresBindings: PostgresCallback[];
  subscribeCbs: StatusCallback[];
  on(
    type: string,
    filter: unknown,
    cb: PostgresCallback
  ): FakeTopicChannel;
  subscribe(cb: StatusCallback): FakeTopicChannel;
}

function makeTopicReusingClient(noteRows: Array<{
  id: string;
  gm_only: boolean;
}>) {
  const channels = new Map<string, FakeTopicChannel>();
  const removed: string[] = [];

  const client = {
    channel(topic: string): FakeTopicChannel {
      const existing = channels.get(topic);
      if (existing) return existing;
      const record: FakeTopicChannel = {
        topic,
        joinedOnce: false,
        postgresBindings: [],
        subscribeCbs: [],
        on(type: string, _filter: unknown, cb: PostgresCallback) {
          if (type === "postgres_changes" && record.joinedOnce) {
            throw new Error(
              `cannot add postgres_changes callbacks for realtime:${topic} after subscribe()`
            );
          }
          record.postgresBindings.push(cb);
          return record;
        },
        subscribe(cb: StatusCallback) {
          record.joinedOnce = true;
          record.subscribeCbs.push(cb);
          queueMicrotask(() => cb("SUBSCRIBED"));
          return record;
        },
      };
      channels.set(topic, record);
      return record;
    },
    removeChannel(channel: FakeTopicChannel) {
      removed.push(channel.topic);
      channels.delete(channel.topic);
      return Promise.resolve("ok");
    },
    from(table: string) {
      return {
        select: () => ({
          eq: async (column: string, value: string) => {
            if (table === "world_notes") {
              expect(column).toBe("location_id");
              expect(value).toBe("location-1");
              return {
                data: noteRows.map((row) => ({
                  ...row,
                  world_id: "world-1",
                  location_id: "location-1",
                  lore_id: null,
                  npc_id: null,
                  created_at: "2026-11-12T00:00:00Z",
                  updated_at: "2026-11-12T00:00:00Z",
                })),
                error: null,
              };
            }
            if (table === "world_note_contents") {
              expect(column).toBe("note_id");
              const marker = value === "note-gm" ? 7 : 3;
              return {
                data: [
                  {
                    note_id: value,
                    content: encodeNoteContent(
                      new Uint8Array([marker, marker + 1])
                    ),
                    updated_at: "2026-11-12T00:00:00Z",
                  },
                ],
                error: null,
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        }),
      };
    },
  };

  return { client, channels, removed };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("world note channel topics per side (#83)", () => {
  it("uses a distinct topic for the GM-only side", () => {
    const publicTopic = constructWorldNoteRowChannelName(
      "location",
      "location-1",
      false
    );
    const gmTopic = constructWorldNoteRowChannelName(
      "location",
      "location-1",
      true
    );

    expect(gmTopic).not.toBe(publicTopic);
  });

  it("keeps both side topics inside the realtime allowlist family", () => {
    // supabase/realtime-auth allowlist: 'world%' covers every world-*
    // topic. Both sides must keep that prefix so no migration is needed.
    for (const gmOnly of [false, true]) {
      expect(
        constructWorldNoteRowChannelName("location", "location-1", gmOnly).startsWith(
          "world"
        )
      ).toBe(true);
    }
  });

  it("co-subscribes GM+public location listeners without throw, each receiving its side", async () => {
    const { client, channels } = makeTopicReusingClient([
      { id: "note-pub", gm_only: false },
      { id: "note-gm", gm_only: true },
    ]);
    mockedGetSupabaseClient.mockReturnValue(client as never);

    const gmNotes: Array<Uint8Array | undefined> = [];
    const pubNotes: Array<Uint8Array | undefined> = [];
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);

    let unGM: (() => void) | undefined;
    let unPub: (() => void) | undefined;
    // The second subscribe threw before the fix (shared topic): with the
    // create-or-reuse fake it throws synchronously out of .on().
    expect(() => {
      unGM = listenToLocationGMNotes(
        "world-1",
        "location-1",
        (notes) => gmNotes.push(notes),
        onError as never
      );
      unPub = listenToLocationNotes(
        "world-1",
        "location-1",
        (notes) => pubNotes.push(notes),
        onError as never
      );
    }).not.toThrow();

    await flush();
    await flush();

    expect(channels.size).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
    expect(gmNotes.some((bytes) => bytes?.[0] === 7)).toBe(true);
    expect(pubNotes.some((bytes) => bytes?.[0] === 3)).toBe(true);

    unGM?.();
    unPub?.();
  });
});
