import type { RealtimeChannel } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";

import { constructChannelPostsChannelName } from "api-calls/chat/_postRef";
import {
  createPerson,
  deletePerson,
  liveStackConfig,
  waitFor,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";

const config = liveStackConfig();

interface Sighting {
  tags: string[];
}

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

async function subscribeAndTrack(
  channel: RealtimeChannel,
  tag: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`presence channel ${tag} never subscribed`)),
      30_000
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error(`presence channel ${tag}: ${status}`));
      }
    });
  });

  // The SDK resolves track() with a status string instead of rejecting, so
  // the missing INSERT policy on realtime.messages used to look like a silent
  // success. Assert the acknowledgement explicitly (ticket #201).
  const result = await channel.track({ tag });
  if (result !== "ok") {
    throw new Error(`presence track for ${tag} was refused: ${result}`);
  }
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
    "lets two signed-in members see each other join and leave on a chat topic",
    { timeout: 180_000 },
    async () => {
      const owner = await createPerson(cfg, "presence-owner");
      const player = await createPerson(cfg, "presence-player");
      people.push(owner, player);

      // Typing indicators (#204) will publish presence on the same topic the
      // post listener uses, so prove that family rather than a synthetic one.
      // The shipped RLS policies allow authenticated clients on `channel-posts%`
      // for both the SELECT (listen) and INSERT (presence write) paths.
      const topic = constructChannelPostsChannelName(crypto.randomUUID());

      const ownerChannel = owner.client.channel(topic, {
        config: { private: true },
      });
      const playerChannel = player.client.channel(topic, {
        config: { private: true },
      });
      channels.push(ownerChannel, playerChannel);

      const ownerSightings: Sighting[] = [];
      const playerSightings: Sighting[] = [];
      ownerChannel.on("presence", { event: "sync" }, () => {
        ownerSightings.push({ tags: presenceTags(ownerChannel) });
      });
      playerChannel.on("presence", { event: "sync" }, () => {
        playerSightings.push({ tags: presenceTags(playerChannel) });
      });

      await subscribeAndTrack(ownerChannel, "presence-owner");
      await subscribeAndTrack(playerChannel, "presence-player");

      expect(
        await waitFor(() =>
          ownerSightings.some((sighting) =>
            sighting.tags.includes("presence-player")
          )
            ? true
            : null
        )
      ).toBe(true);
      expect(
        await waitFor(() =>
          playerSightings.some((sighting) =>
            sighting.tags.includes("presence-owner")
          )
            ? true
            : null
        )
      ).toBe(true);

      // Clear the join observations so a stale sync cannot satisfy a leave
      // assertion; each member must observe the other leave in a fresh event.
      ownerSightings.length = 0;
      await playerChannel.untrack();
      expect(
        await waitFor(() =>
          ownerSightings.some(
            (sighting) => !sighting.tags.includes("presence-player")
          )
            ? true
            : null
        )
      ).toBe(true);

      playerSightings.length = 0;
      await ownerChannel.untrack();
      expect(
        await waitFor(() =>
          playerSightings.some(
            (sighting) => !sighting.tags.includes("presence-owner")
          )
            ? true
            : null
        )
      ).toBe(true);
    }
  );
});
