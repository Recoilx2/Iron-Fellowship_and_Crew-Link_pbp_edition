import { afterEach, describe, expect, it, vi } from "vitest";

import { listenToRows } from "api-calls/realtime/listenToRows";
import {
  createPerson,
  deletePerson,
  liveStackConfig,
  waitFor,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";

const config = liveStackConfig();

interface SettingsRow {
  user_id: string;
  verbose_roll_results: boolean;
  updated_at: string;
}

const getKey = (row: SettingsRow) => row.user_id;
const getUpdatedAt = (row: SettingsRow) => row.updated_at;

async function fetchOwnRows(person: LivePerson): Promise<SettingsRow[]> {
  const { data, error } = await person.client
    .from("user_settings")
    .select("user_id, verbose_roll_results, updated_at")
    .eq("user_id", person.userId);
  if (error) throw error;
  return (data ?? []) as unknown as SettingsRow[];
}

describe.skipIf(!config)("listenToRows against the local stack", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];
  const track = (person: LivePerson) => {
    people.push(person);
    return person;
  };
  afterEach(async () => {
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  it("opens the channel as private", { timeout: 60000 }, async () => {
    const owner = track(await createPerson(cfg, "owner"));
    const channelSpy = vi.spyOn(owner.client, "channel");
    const errors: unknown[] = [];

    const unsubscribe = listenToRows<SettingsRow>({
      client: owner.client,
      channelName: `user-settings:${owner.userId}`,
      bindings: [],
      fetchRows: () => fetchOwnRows(owner),
      getKey,
      onRows: () => {},
      onError: (error) => errors.push(error),
    });
    try {
      expect(channelSpy).toHaveBeenCalledWith(
        `user-settings:${owner.userId}`,
        // The installed SDK merges its broadcast/presence defaults into the
        // params object in place, so exact equality can never match. Match
        // the private flag as a subset: the channel must still be private.
        expect.objectContaining({
          config: expect.objectContaining({ private: true }),
        })
      );
    } finally {
      unsubscribe();
      channelSpy.mockRestore();
    }
    expect(errors).toEqual([]);
  });

  it("delivers the current rows and later changes in order", { timeout: 60000 }, async () => {
    const owner = track(await createPerson(cfg, "owner"));
    await owner.client.from("user_settings").upsert({
      user_id: owner.userId,
      verbose_roll_results: false,
    });

    const seen: boolean[][] = [];
    const errors: unknown[] = [];
    const unsubscribe = listenToRows<SettingsRow>({
      client: owner.client,
      channelName: `user-settings:${owner.userId}`,
      bindings: [
        {
          type: "postgres_changes",
          table: "user_settings",
          filter: `user_id=eq.${owner.userId}`,
          toChange: (payload) => {
            const row = payload.new as Partial<SettingsRow>;
            if (row && typeof row.user_id === "string") {
              return { kind: "upsert", row: row as SettingsRow };
            }
            return null;
          },
        },
      ],
      fetchRows: () => fetchOwnRows(owner),
      getKey,
      getUpdatedAt,
      onRows: (rows) =>
        seen.push(rows.map((row) => row.verbose_roll_results)),
      onError: (error) => errors.push(error),
    });
    try {
      await waitFor(() => (seen.length >= 1 ? seen : null));

      await owner.client
        .from("user_settings")
        .update({ verbose_roll_results: true })
        .eq("user_id", owner.userId);
      await owner.client
        .from("user_settings")
        .update({ verbose_roll_results: false })
        .eq("user_id", owner.userId);

      const final = await waitFor(() =>
        seen.length >= 3 ? seen : null
      );
      expect(final.map((flags) => flags[0])).toEqual([false, true, false]);
      expect(errors).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it("catches up after a forced reconnect", { timeout: 90000 }, async () => {
    const owner = track(await createPerson(cfg, "owner"));
    await owner.client.from("user_settings").upsert({
      user_id: owner.userId,
      verbose_roll_results: false,
    });

    const seen: boolean[][] = [];
    const errors: unknown[] = [];
    const unsubscribe = listenToRows<SettingsRow>({
      client: owner.client,
      channelName: `user-settings:${owner.userId}`,
      bindings: [
        {
          type: "postgres_changes",
          table: "user_settings",
          filter: `user_id=eq.${owner.userId}`,
          toChange: (payload) => {
            const row = payload.new as Partial<SettingsRow>;
            if (row && typeof row.user_id === "string") {
              return { kind: "upsert", row: row as SettingsRow };
            }
            return null;
          },
        },
      ],
      fetchRows: () => fetchOwnRows(owner),
      getKey,
      getUpdatedAt,
      onRows: (rows) =>
        seen.push(rows.map((row) => row.verbose_roll_results)),
      onError: (error) => errors.push(error),
    });
    try {
      await waitFor(() => (seen.length >= 1 ? seen : null));
      expect(seen.at(-1)).toEqual([false]);

      // Drop the live connection, change the row while it is down, reconnect.
      await owner.client.realtime.disconnect();
      await owner.client
        .from("user_settings")
        .update({ verbose_roll_results: true })
        .eq("user_id", owner.userId);
      owner.client.realtime.connect();
      // The forced disconnect above is itself expected to surface CLOSED, so
      // only errors from the reconnect onward indicate a real problem.
      errors.length = 0;

      const caughtUp = await waitFor(() =>
        seen.at(-1)?.[0] === true ? seen : null
      );
      expect(caughtUp.at(-1)).toEqual([true]);
      expect(errors).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it("never delivers another person's rows", { timeout: 60000 }, async () => {
    const owner = track(await createPerson(cfg, "owner"));
    const outsider = track(await createPerson(cfg, "outsider"));
    await owner.client.from("user_settings").upsert({
      user_id: owner.userId,
      verbose_roll_results: true,
    });

    const seen: SettingsRow[][] = [];
    const errors: unknown[] = [];
    const unsubscribe = listenToRows<SettingsRow>({
      client: outsider.client,
      channelName: `user-settings:${owner.userId}`,
      bindings: [
        {
          type: "postgres_changes",
          table: "user_settings",
          filter: `user_id=eq.${owner.userId}`,
          toChange: (payload) => {
            const row = payload.new as Partial<SettingsRow>;
            if (row && typeof row.user_id === "string") {
              return { kind: "upsert", row: row as SettingsRow };
            }
            return null;
          },
        },
      ],
      fetchRows: async () => {
        const { data, error } = await outsider.client
          .from("user_settings")
          .select("user_id, verbose_roll_results, updated_at")
          .eq("user_id", owner.userId);
        if (error) throw error;
        return (data ?? []) as unknown as SettingsRow[];
      },
      getKey,
      getUpdatedAt,
      onRows: (rows) => seen.push(rows),
      onError: (error) => errors.push(error),
    });
    try {
      await waitFor(() => (seen.length >= 1 ? seen : null));
      expect(seen[0]).toEqual([]);

      await owner.client
        .from("user_settings")
        .update({ verbose_roll_results: false })
        .eq("user_id", owner.userId);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(seen).toEqual([[]]);
      expect(errors).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
});
