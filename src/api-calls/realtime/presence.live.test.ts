import type { RealtimeChannel } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";

import {
  createPerson,
  deletePerson,
  liveStackConfig,
  waitFor,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";

const config = liveStackConfig();

function presenceTags(channel: RealtimeChannel): string[] {
  const state = channel.presenceState() as Record<
    string,
    Array<{ tag?: unknown }>
  >;
  return Object.values(state)
    .flat()
    .map((entry) => entry.tag)
    .filter((tag): tag is string => typeof tag === "string");
}

function subscribeAndTrack(
  channel: RealtimeChannel,
  tag: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`presence channel ${tag} never subscribed`)),
      30_000
    );
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try {
          await channel.track({ tag });
          clearTimeout(timer);
          resolve();
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error(`presence channel ${tag}: ${status}`));
      }
    });
  });
}

describe.skipIf(!config)("self-hosted Realtime presence", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];
  const channels: RealtimeChannel[] = [];

  afterEach(async () => {
    for (const channel of channels.splice(0)) {
      await channel.untrack().catch(() => {});
      await channel.unsubscribe().catch(() => {});
    }
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  it(
    "lets two signed-in members see each other on a private topic",
    { timeout: 180_000 },
    async () => {
      const owner = await createPerson(cfg, "presence-owner");
      const player = await createPerson(cfg, "presence-player");
      people.push(owner, player);

      // The shipped RLS policies allow authenticated listeners on any
      // `campaign:%` topic, with extension IN ('broadcast', 'presence')
      // (supabase/realtime-auth/20261112135000_realtime_channel_policies.sql).
      const topic = `campaign:${crypto.randomUUID()}:presence-probe`;

      const ownerChannel = owner.client.channel(topic, {
        config: { private: true },
      });
      const playerChannel = player.client.channel(topic, {
        config: { private: true },
      });
      channels.push(ownerChannel, playerChannel);

      const ownerSightings: string[][] = [];
      const playerSightings: string[][] = [];
      ownerChannel.on("presence", { event: "sync" }, () => {
        ownerSightings.push(presenceTags(ownerChannel));
      });
      playerChannel.on("presence", { event: "sync" }, () => {
        playerSightings.push(presenceTags(playerChannel));
      });

      await subscribeAndTrack(ownerChannel, "presence-owner");
      await subscribeAndTrack(playerChannel, "presence-player");

      expect(
        await waitFor(() =>
          ownerSightings.some((tags) => tags.includes("presence-player"))
            ? true
            : null
        )
      ).toBe(true);
      expect(
        await waitFor(() =>
          playerSightings.some((tags) => tags.includes("presence-owner"))
            ? true
            : null
        )
      ).toBe(true);

      await playerChannel.untrack();
      expect(
        await waitFor(() =>
          ownerSightings.length > 0 &&
          !presenceTags(ownerChannel).includes("presence-player")
            ? true
            : null
        )
      ).toBe(true);
    }
  );
});
