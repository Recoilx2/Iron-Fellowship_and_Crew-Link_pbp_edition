import { describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { listenToAccessibilitySettings } from "api-calls/user/settings/listenToAccessibilitySettings";
import { listenToOracleSettings } from "api-calls/user/settings/listenToOracleSettings";
import {
  constructUserSettingsChannelName,
  type UserSettingsRow,
} from "api-calls/user/settings/_getRef";

vi.mock("config/supabase.config");

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

// Seam under test: accessibility + oracle settings listeners must never
// alias one realtime topic (#90). supabase-js channel() creates-OR-REUSES
// by topic, so two listenToRows on the same topic make the second .on()
// throw ("cannot add postgres_changes callbacks ... after subscribe()") —
// the same hazard class as #83.
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

const SETTINGS_ROW: UserSettingsRow = {
  user_id: "user-1",
  verbose_roll_results: true,
  pinned_oracle_sections: { "ironsworn/oracles/action": true },
  updated_at: "2026-11-12T00:00:01Z",
};

function makeTopicReusingClient() {
  const channels = new Map<string, FakeTopicChannel>();

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
      channels.delete(channel.topic);
      return Promise.resolve("ok");
    },
    from(table: string) {
      if (table !== "user_settings") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: async (column: string, value: string) => {
            expect(column).toBe("user_id");
            expect(value).toBe("user-1");
            return { data: [SETTINGS_ROW], error: null };
          },
        }),
      };
    },
  };

  return { client, channels };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("user settings channel topics per side (#90)", () => {
  it("uses a distinct topic for each side", () => {
    expect(constructUserSettingsChannelName("user-1", "accessibility")).not.toBe(
      constructUserSettingsChannelName("user-1", "oracle")
    );
  });

  it("keeps both side topics inside the realtime allowlist family", () => {
    // supabase/realtime-auth allowlist: 'user-%' covers every user-*
    // topic. Both sides must keep that prefix so no migration is needed.
    for (const scope of ["accessibility", "oracle"] as const) {
      expect(constructUserSettingsChannelName("user-1", scope)).toMatch(
        /^user-/
      );
    }
  });

  it("co-subscribes accessibility + oracle listeners without throw, each receiving rows", async () => {
    const { client } = makeTopicReusingClient();
    mockedGetSupabaseClient.mockReturnValue(client as never);

    const accessibilitySeen: Array<{ verboseRollResults?: boolean }> = [];
    const oracleSeen: Array<{
      pinnedOracleSections?: Record<string, boolean>;
    }> = [];
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);

    let unAccessibility: (() => void) | undefined;
    let unOracle: (() => void) | undefined;
    // The second subscribe threw before the fix (shared topic): with the
    // create-or-reuse fake it throws synchronously out of .on().
    expect(() => {
      unAccessibility = listenToAccessibilitySettings("user-1", (settings) =>
        accessibilitySeen.push(settings)
      );
      unOracle = listenToOracleSettings(
        "user-1",
        (settings) => oracleSeen.push(settings),
        onError
      );
    }).not.toThrow();

    await flush();
    await flush();

    expect(errors).toEqual([]);
    expect(accessibilitySeen).toContainEqual({ verboseRollResults: true });
    expect(oracleSeen).toContainEqual({
      pinnedOracleSections: { "ironsworn/oracles/action": true },
    });

    unAccessibility?.();
    unOracle?.();
  });
});
